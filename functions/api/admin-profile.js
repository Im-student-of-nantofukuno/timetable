export async function onRequestPost(context) {
  try {
    const request = context.request;
    const env = context.env;

    // ========================================
    // 1. Authorization確認
    // ========================================

    const authorization =
      request.headers.get("Authorization");

    if (!authorization) {
      return jsonResponse(
        {
          success: false,
          error: "ログイン情報がありません"
        },
        401
      );
    }

    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse(
        {
          success: false,
          error: "不正なAuthorizationです"
        },
        401
      );
    }

    const accessToken =
      authorization.substring(7);

    // ========================================
    // 2. Supabaseで現在のユーザーを確認
    // ========================================

    const userResponse = await fetch(
      `${env.SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          "Authorization":
            `Bearer ${accessToken}`,
          "apikey":
            env.SUPABASE_ANON_KEY
        }
      }
    );

    if (!userResponse.ok) {
      return jsonResponse(
        {
          success: false,
          error: "Supabase認証に失敗しました"
        },
        401
      );
    }

    const currentUser =
      await userResponse.json();

    if (
      !currentUser ||
      !currentUser.id
    ) {
      return jsonResponse(
        {
          success: false,
          error: "ユーザー情報を取得できませんでした"
        },
        401
      );
    }


    // ========================================
    // 3. 現在のユーザーがdeepか確認
    // ========================================

    const adminProfileResponse =
      await fetch(
        `${env.SUPABASE_URL}/rest/v1/admin_profiles?select=role&user_id=eq.${encodeURIComponent(currentUser.id)}`,
        {
          method: "GET",
          headers: {
            "Authorization":
              `Bearer ${accessToken}`,
            "apikey":
              env.SUPABASE_ANON_KEY
          }
        }
      );

    if (!adminProfileResponse.ok) {
      return jsonResponse(
        {
          success: false,
          error: "管理者権限の確認に失敗しました"
        },
        500
      );
    }

    const profiles =
      await adminProfileResponse.json();

    const currentRole =
      profiles.length > 0
        ? profiles[0].role
        : null;

    if (currentRole !== "deep") {
      return jsonResponse(
        {
          success: false,
          error:
            "管理者を追加する権限がありません"
        },
        403
      );
    }


    // ========================================
    // 4. 登録データを取得
    // ========================================

    const body =
      await request.json();

    const userId =
      String(body.user_id || "").trim();

    const displayName =
      String(body.display_name || "").trim();

    const role =
      String(body.role || "").trim();


    // ========================================
    // 5. 入力値チェック
    // ========================================

    if (!userId) {
      return jsonResponse(
        {
          success: false,
          error: "User IDを入力してください"
        },
        400
      );
    }

    if (!displayName) {
      return jsonResponse(
        {
          success: false,
          error: "表示名を入力してください"
        },
        400
      );
    }

    if (
      role !== "user" &&
      role !== "quick" &&
      role !== "deep" 
    ) {
      return jsonResponse(
        {
          success: false,
          error:
            "roleはquickかdeep、userを指定してください"
        },
        400
      );
    }


    // ========================================
    // 6. admin_profilesへ登録
    // ========================================
    //
    // service role keyを使って
    // Cloudflare側から登録する
    //

    const insertResponse =
      await fetch(
        `${env.SUPABASE_URL}/rest/v1/admin_profiles`,
        {
          method: "POST",
          headers: {
            "apikey":
              env.SUPABASE_SERVICE_ROLE_KEY,

            "Authorization":
              `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,

            "Content-Type":
              "application/json",

            "Prefer":
              "return=representation"
          },
          body: JSON.stringify({
            user_id: userId,
            display_name: displayName,
            role: role
          })
        }
      );

    const insertText =
      await insertResponse.text();

    let insertData;

    try {
      insertData =
        JSON.parse(insertText);
    } catch {
      insertData =
        insertText;
    }

    if (!insertResponse.ok) {
      console.error(
        "admin_profiles insert error:",
        insertResponse.status,
        insertData
      );

      return jsonResponse(
        {
          success: false,
          error:
            "管理者の登録に失敗しました"
        },
        insertResponse.status
      );
    }


    // ========================================
    // 7. 成功
    // ========================================

    return jsonResponse({
      success: true,
      data: insertData
    });

  } catch (error) {

    console.error(
      "admin-profile error:",
      error
    );

    return jsonResponse(
      {
        success: false,
        error: error.message
      },
      500
    );
  }
}

export async function onRequestGet(context) {
  try {
    const request = context.request;
    const env = context.env;

    // ========================================
    // 1. Authorization確認
    // ========================================

    const authorization =
      request.headers.get("Authorization");

    if (!authorization) {
      return jsonResponse(
        {
          success: false,
          error: "ログイン情報がありません"
        },
        401
      );
    }

    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse(
        {
          success: false,
          error: "不正なAuthorizationです"
        },
        401
      );
    }

    const accessToken =
      authorization.substring(7);


    // ========================================
    // 2. 現在のユーザーを確認
    // ========================================

    const userResponse = await fetch(
      `${env.SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          "Authorization":
            `Bearer ${accessToken}`,
          "apikey":
            env.SUPABASE_ANON_KEY
        }
      }
    );

    if (!userResponse.ok) {
      return jsonResponse(
        {
          success: false,
          error: "Supabase認証に失敗しました"
        },
        401
      );
    }

    const currentUser =
      await userResponse.json();

    if (
      !currentUser ||
      !currentUser.id
    ) {
      return jsonResponse(
        {
          success: false,
          error:
            "ユーザー情報を取得できませんでした"
        },
        401
      );
    }


    // ========================================
    // 3. deep権限確認
    // ========================================

    const profileResponse =
      await fetch(
        `${env.SUPABASE_URL}/rest/v1/admin_profiles?select=role&user_id=eq.${encodeURIComponent(currentUser.id)}`,
        {
          method: "GET",
          headers: {
            "Authorization":
              `Bearer ${accessToken}`,
            "apikey":
              env.SUPABASE_ANON_KEY
          }
        }
      );

    if (!profileResponse.ok) {
      return jsonResponse(
        {
          success: false,
          error:
            "管理者権限の確認に失敗しました"
        },
        500
      );
    }

    const profiles =
      await profileResponse.json();

    const currentRole =
      profiles.length > 0
        ? profiles[0].role
        : null;

    if (currentRole !== "deep") {
      return jsonResponse(
        {
          success: false,
          error:
            "管理者一覧を取得する権限がありません"
        },
        403
      );
    }


    // ========================================
    // 4. admin_profiles取得
    // ========================================

    const adminProfilesResponse =
      await fetch(
        `${env.SUPABASE_URL}/rest/v1/admin_profiles?select=user_id,display_name,role`,
        {
          method: "GET",
          headers: {
            "apikey":
              env.SUPABASE_SERVICE_ROLE_KEY,

            "Authorization":
              `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        }
      );

    if (!adminProfilesResponse.ok) {
      return jsonResponse(
        {
          success: false,
          error:
            "管理者プロフィールの取得に失敗しました"
        },
        500
      );
    }

    const adminProfiles =
      await adminProfilesResponse.json();


    // ========================================
    // 5. Authenticationユーザー取得
    // ========================================

    const authUsersResponse =
      await fetch(
        `${env.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
        {
          method: "GET",
          headers: {
            "apikey":
              env.SUPABASE_SERVICE_ROLE_KEY,

            "Authorization":
              `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        }
      );

    if (!authUsersResponse.ok) {
      const text =
        await authUsersResponse.text();

      console.error(
        "Authentication users取得エラー:",
        authUsersResponse.status,
        text
      );

      return jsonResponse(
        {
          success: false,
          error:
            "Authenticationユーザー一覧の取得に失敗しました"
        },
        500
      );
    }

    const authUsersData =
      await authUsersResponse.json();

    const authUsers =
      Array.isArray(authUsersData)
        ? authUsersData
        : authUsersData.users || [];


    // ========================================
    // 6. admin_profilesと結合
    // ========================================

    const adminProfileMap =
      new Map(
        adminProfiles.map(profile => [
          String(profile.user_id),
          profile
        ])
      );

    const users =
      authUsers.map(user => {

        const userId =
          String(user.id || "");

        const profile =
          adminProfileMap.get(userId);

        if (profile) {
          return {
            user_id: userId,
            display_name:
              profile.display_name ||
              user.user_metadata?.display_name ||
              "表示名未設定",
            role:
              profile.role || ""
          };
        }

        // admin_profilesに存在しないユーザーのみ
          return {
            user_id: userId,
            display_name:
              user.user_metadata?.display_name ||
              user.user_metadata?.full_name ||
              user.user_metadata?.name ||
              "表示名未設定",
            role: null
          };
      });


    // ========================================
    // 7. 成功
    // ========================================

    return jsonResponse({
      success: true,
      data: users
    });

  } catch (error) {

    console.error(
      "admin-profile GET error:",
      error
    );

    return jsonResponse(
      {
        success: false,
        error: error.message
      },
      500
    );
  }
}

export async function onRequestDelete(context) {
  try {
    const request = context.request;
    const env = context.env;

    // ========================================
    // 1. Authorization確認
    // ========================================

    const authorization =
      request.headers.get("Authorization");

    if (!authorization) {
      return jsonResponse(
        {
          success: false,
          error: "ログイン情報がありません"
        },
        401
      );
    }

    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse(
        {
          success: false,
          error: "不正なAuthorizationです"
        },
        401
      );
    }

    const accessToken =
      authorization.substring(7);


    // ========================================
    // 2. 現在のユーザーを確認
    // ========================================

    const userResponse = await fetch(
      `${env.SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          "Authorization":
            `Bearer ${accessToken}`,
          "apikey":
            env.SUPABASE_ANON_KEY
        }
      }
    );

    if (!userResponse.ok) {
      return jsonResponse(
        {
          success: false,
          error: "Supabase認証に失敗しました"
        },
        401
      );
    }

    const currentUser =
      await userResponse.json();

    if (
      !currentUser ||
      !currentUser.id
    ) {
      return jsonResponse(
        {
          success: false,
          error:
            "ユーザー情報を取得できませんでした"
        },
        401
      );
    }


    // ========================================
    // 3. 現在のユーザーがdeepか確認
    // ========================================

    const adminProfileResponse =
      await fetch(
        `${env.SUPABASE_URL}/rest/v1/admin_profiles?select=role&user_id=eq.${encodeURIComponent(currentUser.id)}`,
        {
          method: "GET",
          headers: {
            "Authorization":
              `Bearer ${accessToken}`,
            "apikey":
              env.SUPABASE_ANON_KEY
          }
        }
      );

    if (!adminProfileResponse.ok) {
      return jsonResponse(
        {
          success: false,
          error:
            "管理者権限の確認に失敗しました"
        },
        500
      );
    }

    const profiles =
      await adminProfileResponse.json();

    const currentRole =
      profiles.length > 0
        ? profiles[0].role
        : null;

    if (currentRole !== "deep") {
      return jsonResponse(
        {
          success: false,
          error:
            "管理者を削除する権限がありません"
        },
        403
      );
    }


    // ========================================
    // 4. 削除対象を取得
    // ========================================

    const body =
      await request.json();

    const targetUserId =
      String(body.user_id || "").trim();

    if (!targetUserId) {
      return jsonResponse(
        {
          success: false,
          error:
            "削除対象のUser IDがありません"
        },
        400
      );
    }


    // ========================================
    // 5. 自分自身は削除不可
    // ========================================

    if (
      targetUserId === currentUser.id
    ) {
      return jsonResponse(
        {
          success: false,
          error:
            "自分自身のアカウントは削除できません"
        },
        400
      );
    }


    // ========================================
    // 6. admin_profilesから削除
    // ========================================

    const deleteProfileResponse =
      await fetch(
        `${env.SUPABASE_URL}/rest/v1/admin_profiles?user_id=eq.${encodeURIComponent(targetUserId)}`,
        {
          method: "DELETE",
          headers: {
            "apikey":
              env.SUPABASE_SERVICE_ROLE_KEY,

            "Authorization":
              `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,

            "Prefer":
              "return=representation"
          }
        }
      );

    const deleteProfileText =
      await deleteProfileResponse.text();

    let deleteProfileData;

    try {
      deleteProfileData =
        JSON.parse(deleteProfileText);
    } catch {
      deleteProfileData =
        deleteProfileText;
    }

    if (!deleteProfileResponse.ok) {
      console.error(
        "admin_profiles delete error:",
        deleteProfileResponse.status,
        deleteProfileData
      );

      return jsonResponse(
        {
          success: false,
          error:
            "管理者プロフィールの削除に失敗しました"
        },
        deleteProfileResponse.status
      );
    }


    // ========================================
    // 7. Authenticationからユーザー削除
    // ========================================

    const deleteAuthResponse =
      await fetch(
        `${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(targetUserId)}`,
        {
          method: "DELETE",
          headers: {
            "apikey":
              env.SUPABASE_SERVICE_ROLE_KEY,

            "Authorization":
              `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        }
      );

    const deleteAuthText =
      await deleteAuthResponse.text();

    let deleteAuthData;

    try {
      deleteAuthData =
        JSON.parse(deleteAuthText);
    } catch {
      deleteAuthData =
        deleteAuthText;
    }

    if (!deleteAuthResponse.ok) {
      console.error(
        "Authentication user delete error:",
        deleteAuthResponse.status,
        deleteAuthData
      );

      return jsonResponse(
        {
          success: false,
          error:
            "Authenticationからユーザーを削除できませんでした",
          detail:
            deleteAuthData
        },
        deleteAuthResponse.status
      );
    }


    // ========================================
    // 8. 成功
    // ========================================

    return jsonResponse({
      success: true,
      data: {
        user_id: targetUserId,
        admin_profile_deleted:
          Array.isArray(deleteProfileData) &&
          deleteProfileData.length > 0,
        authentication_deleted: true
      }
    });

  } catch (error) {

    console.error(
      "admin-profile DELETE error:",
      error
    );

    return jsonResponse(
      {
        success: false,
        error: error.message
      },
      500
    );
  }
}

// ========================================
// JSONレスポンス
// ========================================
function jsonResponse(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json"
      }
    }
  );
}

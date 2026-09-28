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
      role !== "quick" &&
      role !== "deep"
    ) {
      return jsonResponse(
        {
          success: false,
          error:
            "roleはquickまたはdeepを指定してください"
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
            "自分自身の管理者権限は削除できません"
        },
        400
      );
    }


    // ========================================
    // 6. 管理者プロフィールを削除
    // ========================================

    const deleteResponse =
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

    const deleteText =
      await deleteResponse.text();

    let deleteData;

    try {
      deleteData =
        JSON.parse(deleteText);
    } catch {
      deleteData =
        deleteText;
    }

    if (!deleteResponse.ok) {
      console.error(
        "admin_profiles delete error:",
        deleteResponse.status,
        deleteData
      );

      return jsonResponse(
        {
          success: false,
          error:
            "管理者の削除に失敗しました"
        },
        deleteResponse.status
      );
    }


    // ========================================
    // 7. 削除対象が存在しなかった場合
    // ========================================

    if (
      !Array.isArray(deleteData) ||
      deleteData.length === 0
    ) {
      return jsonResponse(
        {
          success: false,
          error:
            "指定された管理者が見つかりません"
        },
        404
      );
    }


    // ========================================
    // 8. 成功
    // ========================================

    return jsonResponse({
      success: true,
      data: deleteData
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

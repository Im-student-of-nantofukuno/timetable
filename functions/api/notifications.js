
export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (
      !env.SUPABASE_URL ||
      !env.SUPABASE_ANON_KEY ||
      !env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      console.error("Required Supabase environment variables are missing.");
      return jsonResponse(
        { success: false, error: "サーバー設定が不足しています。" },
        500
      );
    }

    const authorization = request.headers.get("Authorization") || "";

    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse(
        { success: false, error: "ログイン情報がありません。" },
        401
      );
    }

    const accessToken = authorization.slice(7);

    // 1. Supabaseでログイン状態を確認
    const userResponse = await fetch(
      `${env.SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: env.SUPABASE_ANON_KEY
        }
      }
    );

    if (!userResponse.ok) {
      return jsonResponse(
        { success: false, error: "Supabase認証に失敗しました。" },
        401
      );
    }

    const user = await userResponse.json();

    if (!user?.id) {
      return jsonResponse(
        { success: false, error: "ユーザー情報を取得できませんでした。" },
        401
      );
    }

    // 2. ログイン中の本人の管理者権限を確認
    const profileResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/admin_profiles?select=user_id,role&user_id=eq.${encodeURIComponent(user.id)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: env.SUPABASE_ANON_KEY
        }
      }
    );

    if (!profileResponse.ok) {
      console.error(
        "Admin profile check failed:",
        profileResponse.status
      );

      return jsonResponse(
        { success: false, error: "管理者情報を確認できませんでした。" },
        500
      );
    }

    const profiles = await profileResponse.json();
    const role = profiles[0]?.role;

    if (role !== "quick" && role !== "deep") {
      return jsonResponse(
        { success: false, error: "お知らせを管理する権限がありません。" },
        403
      );
    }

    // 3. リクエスト内容を確認
    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { success: false, error: "リクエスト形式が不正です。" },
        400
      );
    }

    // サーバー側でのみ使用する強い権限のキー
    const serviceHeaders = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    };

    const NOTIFICATION_TARGETS = {
      grades: new Set(["all", "1", "2", "3"]),
      classes: new Set(["all", "1", "2", "3", "4", "5", "6", "7"]),
      courses: new Set([
        "all",
        "none",
        "humanities",
        "science",
        "explore-humanities",
        "explore-science"
      ])
    };
    function isValidTargetArray(values, allowedValues) {
      return (
        Array.isArray(values) &&
        values.length >= 1 &&
        values.length <= allowedValues.size &&
        values.every(
          value =>
            typeof value === "string" &&
            allowedValues.has(value)
        ) &&
        new Set(values).size === values.length
      );
    }
    
    if (body.action === "insert") {
      const notification = body.notification;

      if (
        !notification ||
        typeof notification.id !== "string" ||
        !notification.id.trim() ||
        typeof notification.title !== "string" ||
        typeof notification.body !== "string" ||
        typeof notification.display_start !== "string" ||
        !Number.isFinite(Date.parse(notification.display_start)) ||
        typeof notification.display_end !== "string" ||
        !Number.isFinite(Date.parse(notification.display_end)) ||
        !notification.targets ||
        !isValidTargetArray(
          notification.targets.grades,
          NOTIFICATION_TARGETS.grades
        ) ||
        !isValidTargetArray(
          notification.targets.classes,
          NOTIFICATION_TARGETS.classes
        ) ||
        !isValidTargetArray(
          notification.targets.courses,
          NOTIFICATION_TARGETS.courses
        )
        (
          notification.kind !== undefined &&
          typeof notification.kind !== "string"
        )
      ) {
        return jsonResponse(
          { success: false, error: "お知らせの内容が不正です。" },
          400
        );
      }

      const insertResponse = await fetch(
        `${env.SUPABASE_URL}/rest/v1/notifications?select=*`,
        {
          method: "POST",
          headers: {
            ...serviceHeaders,
            Prefer: "return=representation"
          },
          body: JSON.stringify([notification])
        }
      );

      const resultText = await insertResponse.text();

      if (!insertResponse.ok) {
        console.error(
          "notifications insert failed:",
          insertResponse.status
        );

        return jsonResponse(
          { success: false, error: "お知らせを保存できませんでした。" },
          500
        );
      }

      const rows = resultText ? JSON.parse(resultText) : [];

      return jsonResponse({
        success: true,
        data: rows[0] || notification
      });
    }

    if (body.action === "delete") {
      if (
        typeof body.id !== "string" ||
        !body.id.trim()
      ) {
        return jsonResponse(
          { success: false, error: "削除対象が指定されていません。" },
          400
        );
      }

      const deleteResponse = await fetch(
        `${env.SUPABASE_URL}/rest/v1/notifications?id=eq.${encodeURIComponent(body.id)}`,
        {
          method: "DELETE",
          headers: {
            ...serviceHeaders,
            Prefer: "return=minimal"
          }
        }
      );

      if (!deleteResponse.ok) {
        const errorText = await deleteResponse.text();

        console.error(
          "notifications delete failed:",
          deleteResponse.status
        );

        return jsonResponse(
          { success: false, error: "お知らせを削除できませんでした。" },
          500
        );
      }

      return jsonResponse({ success: true });
    }

    return jsonResponse(
      { success: false, error: "許可されていない操作です。" },
      400
    );
  } catch (error) {
    console.error("notifications API failed");
  
    return jsonResponse(
      {
        success: false,
        error: "サーバー内部でエラーが発生しました。"
      },
      500
    );
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

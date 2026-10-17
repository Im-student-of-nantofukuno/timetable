
export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const authorization = request.headers.get("Authorization") || "";

    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse({ success: false, error: "ログイン情報がありません。" }, 401);
    }

    const accessToken = authorization.slice(7);
    const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: env.SUPABASE_ANON_KEY
      }
    });

    if (!userResponse.ok) {
      return jsonResponse({ success: false, error: "Supabase認証に失敗しました。" }, 401);
    }

    const user = await userResponse.json();
    if (!user?.id) {
      return jsonResponse({ success: false, error: "ユーザー情報を取得できませんでした。" }, 401);
    }

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
      return jsonResponse({ success: false, error: "管理者情報を確認できませんでした。" }, 500);
    }

    const profiles = await profileResponse.json();
    const role = profiles[0]?.role;

    if (role !== "quick" && role !== "deep") {
      return jsonResponse({ success: false, error: "お知らせを管理する権限がありません。" }, 403);
    }

    const body = await request.json();
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      apikey: env.SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    };

    if (body.action === "insert") {
      const notification = body.notification;

      if (
        !notification ||
        typeof notification.id !== "string" ||
        typeof notification.title !== "string" ||
        typeof notification.body !== "string" ||
        !notification.display_start ||
        !notification.display_end ||
        !notification.targets ||
        !Array.isArray(notification.targets.grades) ||
        !Array.isArray(notification.targets.classes) ||
        !Array.isArray(notification.targets.courses)
      ) {
        return jsonResponse({ success: false, error: "お知らせの内容が不正です。" }, 400);
      }

      const insertResponse = await fetch(
        `${env.SUPABASE_URL}/rest/v1/notifications?select=*`,
        {
          method: "POST",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify([notification])
        }
      );

      const resultText = await insertResponse.text();
      if (!insertResponse.ok) {
        console.error("notifications insert failed:", insertResponse.status, resultText);
        return jsonResponse({ success: false, error: "お知らせを保存できませんでした。" }, 500);
      }

      const rows = resultText ? JSON.parse(resultText) : [];
      return jsonResponse({ success: true, data: rows[0] || notification });
    }

    if (body.action === "delete") {
      if (typeof body.id !== "string" || !body.id.trim()) {
        return jsonResponse({ success: false, error: "削除対象が指定されていません。" }, 400);
      }

      const deleteResponse = await fetch(
        `${env.SUPABASE_URL}/rest/v1/notifications?id=eq.${encodeURIComponent(body.id)}`,
        {
          method: "DELETE",
          headers: { ...headers, Prefer: "return=minimal" }
        }
      );

      if (!deleteResponse.ok) {
        const errorText = await deleteResponse.text();
        console.error("notifications delete failed:", deleteResponse.status, errorText);
        return jsonResponse({ success: false, error: "お知らせを削除できませんでした。" }, 500);
      }

      return jsonResponse({ success: true });
    }

    return jsonResponse({ success: false, error: "許可されていない操作です。" }, 400);
  } catch (error) {
    console.error("notifications API error:", error);
    return jsonResponse({ success: false, error: "サーバー側で処理に失敗しました。" }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

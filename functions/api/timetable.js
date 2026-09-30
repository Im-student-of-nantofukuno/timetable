export async function onRequestGet(context) {
  try {
    const env = context.env;
    const request = context.request;
    const requestUrl = new URL(context.request.url);
    console.log("受信したGET URL:", requestUrl.toString());
    
    // ブラウザから送られたGETパラメータを取得 
    const params = requestUrl.searchParams;

    const teacherId = params.get("teacher_id");

    if (teacherId) {
      const authResult =
        await authenticateRegisteredUser(
          request,
          env
        );

      if (!authResult.success) {
        return jsonResponse(
          {
            success: false,
            error: authResult.error
          },
          authResult.status
        );
      }
    }
    
    // GASへそのまま転送するURLを作る
    const gasUrl = new URL(env.GAS_API_URL);

    for (const [key, value] of params.entries()) {
      gasUrl.searchParams.set(key, value);
    }

    console.log("GAS GET request:", gasUrl.toString());

    // Cloudflare側からGASへアクセス
    const gasResponse = await fetch(gasUrl.toString());
    const gasText = await gasResponse.text();

    console.log("GAS GET status:", gasResponse.status);
    console.log(
      "GAS GET content-type:",
      gasResponse.headers.get("content-type")
    );
    console.log("GAS GET final URL:", gasResponse.url);
    console.log("GAS GET redirected:", gasResponse.redirected);

    let gasData;

    try {
      gasData = JSON.parse(gasText);
    } catch (error) {
      console.error("GAS GET response:", gasText);

      return jsonResponse(
        {
          success: false,
          error: "GASからJSONではない応答が返されました"
        },
        502
      );
    }

    return jsonResponse(
      gasData,
      gasResponse.ok ? 200 : gasResponse.status
    );

  } catch (error) {
    console.error("timetable GET error:", error);

    return jsonResponse(
      {
        success: false,
        error: error.message
      },
      500
    );
  }
}

async function authenticateRegisteredUser(request, env) {
  const authorization =
    request.headers.get("Authorization");

  if (!authorization) {
    return {
      success: false,
      status: 401,
      error: "ログインが必要です"
    };
  }

  const match =
    authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return {
      success: false,
      status: 401,
      error: "認証情報が正しくありません"
    };
  }

  const accessToken = match[1];

  // Supabase Authでアクセストークンを確認
  const userResponse = await fetch(
    `${env.SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!userResponse.ok) {
    return {
      success: false,
      status: 401,
      error: "ログイン状態を確認できません"
    };
  }

  const user = await userResponse.json();

  if (!user?.id) {
    return {
      success: false,
      status: 401,
      error: "ユーザー情報を取得できません"
    };
  }

  // admin_profiles に登録されているか確認
  const profileResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/admin_profiles` +
    `?user_id=eq.${encodeURIComponent(user.id)}` +
    `&select=user_id,role`,
    {
      method: "GET",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    }
  );

  if (!profileResponse.ok) {
    console.error(
      "admin_profiles確認失敗:",
      profileResponse.status
    );

    return {
      success: false,
      status: 500,
      error: "権限情報を確認できません"
    };
  }

  const profiles =
    await profileResponse.json();

  if (!Array.isArray(profiles) || !profiles.length) {
    return {
      success: false,
      status: 403,
      error: "この情報を取得する権限がありません"
    };
  }

  return {
    success: true,
    userId: user.id,
    role: profiles[0].role
  };
}

function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

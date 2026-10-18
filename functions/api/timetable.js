export async function onRequestGet(context) {
  try {
    const env = context.env;
    const request = context.request;
    const requestUrl = new URL(context.request.url);
    
    // ブラウザから送られたGETパラメータを取得 
    const params = requestUrl.searchParams;

    const teacherId = params.get("teacher_id");
    const admin = params.get("admin");
    
    // 教員の時間割：登録済みユーザーのみ
    if (teacherId) {
      const authResult =
        await authenticateRegisteredUser(request, env);
    
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

    // クラス情報のみ：ログイン済みの登録ユーザー
    if (admin === "classMetadata") {
      const authResult =
        await authenticateRegisteredUser(request, env);

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
    
    // 浅い管理画面：quick / deep のみ
    if (admin === "quick") {
      const authResult =
        await authenticateRegisteredUser(request, env);
    
      if (!authResult.success) {
        return jsonResponse(
          {
            success: false,
            error: authResult.error
          },
          authResult.status
        );
      }
    
      if (
        authResult.role !== "quick" &&
        authResult.role !== "deep"
      ) {
        return jsonResponse(
          {
            success: false,
            error: "この情報を取得する権限がありません"
          },
          403
        );
      }
    }
    
    // 重複情報：quick / deep のみ
    if (admin === "conflicts") {
      const authResult =
        await authenticateRegisteredUser(request, env);
    
      if (!authResult.success) {
        return jsonResponse(
          {
            success: false,
            error: authResult.error
          },
          authResult.status
        );
      }
    
      if (
        authResult.role !== "quick" &&
        authResult.role !== "deep"
      ) {
        return jsonResponse(
          {
            success: false,
            error: "この情報を取得する権限がありません"
          },
          403
        );
      }
    }
    
    // GASへの読み取りリクエストは、認証付きPOSTで送信する
    const gasReadSecret = env.GAS_READ_SECRET;

    if (!gasReadSecret) {
      console.error("GAS_READ_SECRETが設定されていません");
      return jsonResponse(
        { success: false, error: "サーバー設定エラー" },
        500
      );
    }

    const gasResponse = await fetch(env.GAS_API_URL, {
      method: "POST",
      redirect: "follow",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "readTimetable",
        params: Object.fromEntries(params.entries()),
        secret: gasReadSecret
      })
    });

    // 通信経路の調査用ログ。秘密情報やクエリ文字列は記録しない
    if (gasResponse.redirected || !gasResponse.ok) {
      let finalUrl = null;
    
      try {
        const parsedUrl = new URL(gasResponse.url);
        finalUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
      } catch {
        finalUrl = "URLを取得できません";
      }
    
      console.warn("GAS通信経路の診断:", {
        status: gasResponse.status,
        redirected: gasResponse.redirected,
        finalUrl,
        contentType: gasResponse.headers.get("content-type")
      });
    }
    
    const gasText = await gasResponse.text();
      
    let gasData;

    try {
      gasData = JSON.parse(gasText);
    } catch (error) {
      console.error("GAS読み取り応答のJSON解析に失敗しました", {
        status: gasResponse.status,
        contentType: gasResponse.headers.get("content-type"),
        redirected: gasResponse.redirected
      });

      return jsonResponse(
        {
          success: false,
          error: "時間割データを取得できませんでした"
        },
        502
      );
    }

    if (!gasResponse.ok) {
      console.error("GAS読み取りリクエスト失敗:", gasResponse.status);

      return jsonResponse(
        {
          success: false,
          error: "時間割データを取得できませんでした"
        },
        502
      );
    }

    return jsonResponse(gasData, 200);


  } catch (error) {
    console.error("timetable GET failed");
  
    return jsonResponse(
      {
        success: false,
        error: "サーバー内部でエラーが発生しました"
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

export async function onRequestPost(context) {
  try {
    const request = context.request;
    const env = context.env;

    // ========================================
    // 1. ブラウザからログイン情報を受け取る
    // ========================================
    const authorization = request.headers.get("Authorization");

    if (!authorization) {
      return jsonResponse(
        { success: false, error: "ログイン情報がありません" },
        401
      );
    }

    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse(
        { success: false, error: "不正なAuthorizationです" },
        401
      );
    }

    const accessToken = authorization.substring(7); 

    // ========================================
    // 2. ブラウザから送られたデータを取得
    // ========================================
    const body = await request.json();

    // ========================================
    // 3. Supabaseでアクセストークンを確認
    // ========================================
    const userResponse = await fetch(
      `${env.SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "apikey": env.SUPABASE_ANON_KEY
        }
      }
    );

    if (!userResponse.ok) {
      return jsonResponse(
        { success: false, error: "Supabase認証に失敗しました" },
        401
      );
    }

    const user = await userResponse.json();

    if (!user || !user.id) {
      return jsonResponse(
        { success: false, error: "ユーザー情報を取得できませんでした" },
        401
      );
    }

    // ========================================
    // 4. admin_profilesで管理者か確認
    // ========================================
    const adminProfileResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/admin_profiles?select=user_id,role&user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "apikey": env.SUPABASE_ANON_KEY
        }
      }
    );

    if (!adminProfileResponse.ok) {
      return jsonResponse(
        { success: false, error: "管理者情報の確認に失敗しました" },
        500
      );
    }


    const profiles = await adminProfileResponse.json();

    const role =
      profiles.length > 0
        ? profiles[0].role
        : null;

    
    // ========================================
    // actionごとの権限確認
    // ========================================

    const action = body.action;

    // 浅い管理画面からの時間割変更
    const quickActions = [
      "updateTimetableChange"
    ];

    // 深い管理画面からの操作
    const deepActions = [
      "updateTimetableBase"
    ];


    // 未知のaction
    if (
      !quickActions.includes(action) &&
      !deepActions.includes(action)
    ) {
      return jsonResponse(
        {
          success: false,
          error: "許可されていない操作です"
        },
        403
      );
    }


    // quick / deep が使える操作
    if (quickActions.includes(action)) {

      if (
        role !== "quick" &&
        role !== "deep"
      ) {
        return jsonResponse(
          {
            success: false,
            error: "時間割変更の権限がありません"
          },
          403
        );
      }
    }


// deep のみ使える操作
if (deepActions.includes(action)) {

  if (role !== "deep") {
    return jsonResponse(
      {
        success: false,
        error: "深い管理操作を行う権限がありません"
      },
      403
    );
  }
}
    // ========================================
    // 5. GASへデータを送信
    // ========================================
    const gasStartTime = Date.now();

    const gasResponse = await fetch(
      env.GAS_API_URL,
      {
        method: "POST",
        redirect: "follow",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...body,
          secret: env.GAS_WRITE_SECRET
        })
      }
    );

    const gasText = await gasResponse.text();

    let gasData;

    try {
      gasData = JSON.parse(gasText);
    } catch (error) {
      console.error("GAS response JSON parsing failed");
    
      if (!gasResponse.ok || gasData?.success !== true) {
        console.error("GAS timetable change failed");
      
        return jsonResponse(
          {
            success: false,
            error: "時間割変更の処理に失敗しました"
          },
          502
        );
      }

    return jsonResponse(gasData, 200);
  
  } catch (error) {
    console.error("timetable-change request failed");
  
    return jsonResponse(
      {
        success: false,
        error: "サーバー内部でエラーが発生しました"
      },
      500
    );
  }
}


// ========================================
// JSONレスポンス用
// ========================================
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

export async function onRequestGet(context) {
  try {
    const env = context.env;
    const requestUrl = new URL(context.request.url);

    // ブラウザから送られたGETパラメータを取得
    const params = requestUrl.searchParams;
    
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

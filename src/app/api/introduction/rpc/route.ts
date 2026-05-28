export const runtime = "nodejs";
export const maxDuration = 60;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export async function POST(request: Request) {
  const upstreamUrl = process.env.INTRO_ADMIN_RPC_URL;

  if (!upstreamUrl) {
    return jsonResponse(
      {
        status: "error",
        message: "INTRO_ADMIN_RPC_URL is not configured.",
      },
      500
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "");
    const payload = body?.payload || {};

    const formData = new FormData();
    formData.append("action", action);
    formData.append("payload", JSON.stringify(payload));

    const upstreamResp = await fetch(upstreamUrl, {
      method: "POST",
      body: formData,
      cache: "no-store",
    });

    const text = await upstreamResp.text();

    return new Response(text, {
      status: upstreamResp.status,
      headers: {
        "Content-Type":
          upstreamResp.headers.get("Content-Type") ||
          "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

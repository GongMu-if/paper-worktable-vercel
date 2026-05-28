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
  const upstreamUrl = process.env.INTRO_SUBMIT_REFERENCE_URL;

  if (!upstreamUrl) {
    return jsonResponse(
      {
        status: "error",
        message: "INTRO_SUBMIT_REFERENCE_URL is not configured.",
      },
      500
    );
  }

  try {
    const incomingForm = await request.formData();

    const file = incomingForm.get("file");
    const userId = String(incomingForm.get("user_id") || "");
    const innovationText = String(incomingForm.get("innovation_text") || "");
    const sourceName = String(incomingForm.get("source_name") || "");

    if (!(file instanceof File)) {
      return jsonResponse(
        {
          status: "error",
          message: "Missing main reference PDF file.",
        },
        400
      );
    }

    if (!innovationText.trim()) {
      return jsonResponse(
        {
          status: "error",
          message: "Missing innovation_text.",
        },
        400
      );
    }

    const formData = new FormData();
    formData.append("user_id", userId);
    formData.append("innovation_text", innovationText);
    formData.append("source_name", sourceName || file.name);
    formData.append("file", file, file.name);

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

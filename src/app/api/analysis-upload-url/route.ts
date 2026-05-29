export const runtime = "nodejs";
export const maxDuration = 60;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const upstreamUrl = process.env.DIRECT_ANALYSIS_UPLOAD_URL || process.env.NEXT_PUBLIC_DIRECT_ANALYSIS_UPLOAD_URL;

  if (!upstreamUrl) {
    return jsonResponse(
      {
        status: "error",
        message: "DIRECT_ANALYSIS_UPLOAD_URL/NEXT_PUBLIC_DIRECT_ANALYSIS_UPLOAD_URL is not configured.",
      },
      500,
    );
  }

  try {
    const incomingForm = await request.formData();

    const formData = new FormData();
    formData.append("job_id", String(incomingForm.get("job_id") || ""));
    formData.append("source_name", String(incomingForm.get("source_name") || ""));
    formData.append("cache_key", String(incomingForm.get("cache_key") || ""));
    formData.append("file_url", String(incomingForm.get("file_url") || ""));
    formData.append("storage_path", String(incomingForm.get("storage_path") || ""));

    const upstreamResp = await fetch(upstreamUrl, {
      method: "POST",
      body: formData,
      cache: "no-store",
    });

    const text = await upstreamResp.text();

    return new Response(text, {
      status: upstreamResp.status,
      headers: {
        "Content-Type": upstreamResp.headers.get("Content-Type") || "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}

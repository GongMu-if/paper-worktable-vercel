export const runtime = "nodejs";
export const maxDuration = 60;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type": "application/json; charset=utf-8"},
  });
}

export async function POST(request: Request) {
  const upstreamUrl = process.env.INTRO_SUBMIT_SUPPORTING_URLS_URL;

  if (!upstreamUrl) {
    return jsonResponse({
      status: "error",
      message: "INTRO_SUBMIT_SUPPORTING_URLS_URL is not configured.",
    }, 500);
  }

  try {
    const incomingForm = await request.formData();

    const formData = new FormData();
    formData.append("job_id", String(incomingForm.get("job_id") || ""));
    formData.append("supporting_files", String(incomingForm.get("supporting_files") || "[]"));

    // 兼容旧的两文件字段；新后端优先读取 supporting_files。
    formData.append("support_name_1", String(incomingForm.get("support_name_1") || ""));
    formData.append("support_name_2", String(incomingForm.get("support_name_2") || ""));
    formData.append("file_url_1", String(incomingForm.get("file_url_1") || ""));
    formData.append("file_url_2", String(incomingForm.get("file_url_2") || ""));
    formData.append("storage_path_1", String(incomingForm.get("storage_path_1") || ""));
    formData.append("storage_path_2", String(incomingForm.get("storage_path_2") || ""));

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
    return jsonResponse({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

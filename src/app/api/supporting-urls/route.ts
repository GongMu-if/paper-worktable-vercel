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
    return jsonResponse({status: "error", message: "INTRO_SUBMIT_SUPPORTING_URLS_URL is not configured."}, 500);
  }

  try {
    const incomingForm = await request.formData();

    const formData = new FormData();
    for (const key of [
      "job_id",
      "supporting_files",
      "support_name_1",
      "support_name_2",
      "file_url_1",
      "file_url_2",
      "storage_path_1",
      "storage_path_2",
      "manuscript_pdf_name",
      "manuscript_file_url",
      "manuscript_storage_path",
    ]) {
      formData.append(key, String(incomingForm.get(key) || ""));
    }

    const upstreamResp = await fetch(upstreamUrl, {
      method: "POST",
      body: formData,
      cache: "no-store",
    });

    const text = await upstreamResp.text();
    return new Response(text, {
      status: upstreamResp.status,
      headers: {"Content-Type": upstreamResp.headers.get("Content-Type") || "application/json; charset=utf-8"},
    });
  } catch (error) {
    return jsonResponse({status: "error", message: error instanceof Error ? error.message : String(error)}, 500);
  }
}

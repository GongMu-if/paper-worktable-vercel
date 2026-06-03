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
  const upstreamUrl = process.env.INTRO_SUBMIT_DIRECT_REFERENCES_URL;

  if (!upstreamUrl) {
    return jsonResponse(
      {
        status: "error",
        message: "INTRO_SUBMIT_DIRECT_REFERENCES_URL is not configured.",
      },
      500
    );
  }

  try {
    const incomingForm = await request.formData();

    const userId = String(incomingForm.get("user_id") || "");
    const innovationText = String(incomingForm.get("innovation_text") || "");
    const referenceFiles = String(incomingForm.get("reference_files") || "[]");
    const manuscriptPdfName = String(incomingForm.get("manuscript_pdf_name") || "");
    const manuscriptFileUrl = String(incomingForm.get("manuscript_file_url") || "");
    const manuscriptStoragePath = String(incomingForm.get("manuscript_storage_path") || "");

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
    formData.append("reference_files", referenceFiles);
    formData.append("manuscript_pdf_name", manuscriptPdfName);
    formData.append("manuscript_file_url", manuscriptFileUrl);
    formData.append("manuscript_storage_path", manuscriptStoragePath);

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

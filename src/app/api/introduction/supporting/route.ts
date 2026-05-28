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
  const upstreamUrl = process.env.INTRO_SUBMIT_SUPPORTING_URL;

  if (!upstreamUrl) {
    return jsonResponse(
      {
        status: "error",
        message: "INTRO_SUBMIT_SUPPORTING_URL is not configured.",
      },
      500
    );
  }

  try {
    const incomingForm = await request.formData();

    const jobId = String(incomingForm.get("job_id") || "");
    const file1 = incomingForm.get("file1");
    const file2 = incomingForm.get("file2");
    const supportName1 = String(incomingForm.get("support_name_1") || "");
    const supportName2 = String(incomingForm.get("support_name_2") || "");

    if (!jobId.trim()) {
      return jsonResponse(
        {
          status: "error",
          message: "Missing job_id.",
        },
        400
      );
    }

    if (!(file1 instanceof File) || !(file2 instanceof File)) {
      return jsonResponse(
        {
          status: "error",
          message: "Please upload two supporting PDF files.",
        },
        400
      );
    }

    const formData = new FormData();
    formData.append("job_id", jobId);
    formData.append("support_name_1", supportName1 || file1.name);
    formData.append("support_name_2", supportName2 || file2.name);
    formData.append("file1", file1, file1.name);
    formData.append("file2", file2, file2.name);

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

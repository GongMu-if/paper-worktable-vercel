import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const uploadUrl = process.env.FRONTEND_UPLOAD_INTRODUCTION_REFERENCES_URL;
  if (!uploadUrl) {
    return NextResponse.json(
      { status: "error", message: "Missing FRONTEND_UPLOAD_INTRODUCTION_REFERENCES_URL in Vercel environment variables." },
      { status: 500 },
    );
  }

  const incoming = await request.formData();
  const outbound = new FormData();

  outbound.append("intro_job_id", String(incoming.get("intro_job_id") || ""));

  const files = incoming.getAll("files");
  for (const file of files) {
    if (file instanceof File) {
      outbound.append("files", file, file.name || "reference.pdf");
    }
  }

  const upstream = await fetch(uploadUrl, {
    method: "POST",
    body: outbound,
  });

  const text = await upstream.text();
  try {
    return NextResponse.json(JSON.parse(text), { status: upstream.status });
  } catch {
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "text/plain" },
    });
  }
}

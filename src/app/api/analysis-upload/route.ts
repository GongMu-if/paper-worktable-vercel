import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const uploadUrl = process.env.FRONTEND_SUBMIT_ANALYSIS_JOB_URL;
  if (!uploadUrl) {
    return NextResponse.json(
      { status: "error", message: "Missing FRONTEND_SUBMIT_ANALYSIS_JOB_URL in Vercel environment variables." },
      { status: 500 },
    );
  }

  const incoming = await request.formData();
  const outbound = new FormData();
  outbound.append("job_id", String(incoming.get("job_id") || ""));
  outbound.append("source_name", String(incoming.get("source_name") || "未命名论文"));
  outbound.append("cache_key", String(incoming.get("cache_key") || ""));

  const file = incoming.get("file");
  if (file instanceof File) {
    outbound.append("file", file, file.name || "paper.pdf");
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

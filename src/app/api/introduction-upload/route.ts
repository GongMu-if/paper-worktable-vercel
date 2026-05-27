import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const uploadUrl = process.env.FRONTEND_SUBMIT_INTRODUCTION_JOB_URL;
  if (!uploadUrl) {
    return NextResponse.json(
      { status: "error", message: "Missing FRONTEND_SUBMIT_INTRODUCTION_JOB_URL in Vercel environment variables." },
      { status: 500 },
    );
  }

  const incoming = await request.formData();
  const outbound = new FormData();

  outbound.append("intro_job_id", String(incoming.get("intro_job_id") || ""));
  outbound.append("username", String(incoming.get("username") || ""));
  outbound.append("title", String(incoming.get("title") || "Introduction 写作任务"));
  outbound.append("has_seed_pdf", String(incoming.get("has_seed_pdf") || "false"));
  outbound.append("manual_problem_text", String(incoming.get("manual_problem_text") || ""));
  outbound.append("task_goal", String(incoming.get("task_goal") || ""));
  outbound.append("task_granularity", String(incoming.get("task_granularity") || ""));
  outbound.append("research_object", String(incoming.get("research_object") || ""));
  outbound.append("input_output", String(incoming.get("input_output") || ""));
  outbound.append("has_user_innovation", String(incoming.get("has_user_innovation") || "false"));
  outbound.append("user_innovation_text", String(incoming.get("user_innovation_text") || ""));
  outbound.append("target_language", String(incoming.get("target_language") || "中文"));
  outbound.append("target_words", String(incoming.get("target_words") || ""));

  const file = incoming.get("file");
  if (file instanceof File) {
    outbound.append("file", file, file.name || "seed.pdf");
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

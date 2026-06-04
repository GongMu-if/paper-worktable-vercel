// src/app/api/reviewer/submit/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const papers = Array.isArray(body.papers) ? body.papers : [];
    if (!papers.length) {
      return NextResponse.json({ ok: false, error: "至少上传一篇 PDF" }, { status: 400 });
    }
    if (papers.length > 20) {
      return NextResponse.json({ ok: false, error: "单次最多支持 20 篇论文" }, { status: 400 });
    }

    const modalUrl = process.env.REVIEW_SUBMIT_URL;
    if (!modalUrl) {
      return NextResponse.json({ ok: false, error: "缺少 REVIEW_SUBMIT_URL" }, { status: 500 });
    }

    const resp = await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ papers }),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) {
      return NextResponse.json({ ok: false, error: json.error || "Modal 审稿任务提交失败" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, jobId: json.jobId, paperCount: json.paperCount });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "提交审稿任务失败" }, { status: 500 });
  }
}

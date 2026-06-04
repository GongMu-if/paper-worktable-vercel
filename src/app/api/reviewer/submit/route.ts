// src/app/api/reviewer/submit/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const defaultBucket = process.env.REVIEW_STORAGE_BUCKET || "review-pdfs";
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ ok: false, error: "缺少 Supabase 服务端环境变量" }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const signedPapers = [];
    for (const item of papers) {
      const fileName = String(item.fileName || item.file_name || "paper.pdf");
      const bucket = String(item.bucket || defaultBucket);
      const storagePath = String(item.storagePath || item.storage_path || "");
      if (!storagePath) {
        return NextResponse.json({ ok: false, error: `${fileName} 缺少 storagePath` }, { status: 400 });
      }

      const { data, error } = await admin.storage
        .from(bucket)
        .createSignedUrl(storagePath, 60 * 60 * 24);

      if (error || !data?.signedUrl) {
        return NextResponse.json({
          ok: false,
          error: `创建 ${fileName} 的下载签名失败：${error?.message || "unknown error"}`,
        }, { status: 500 });
      }

      signedPapers.push({
        file_name: fileName,
        bucket,
        storage_path: storagePath,
        file_url: data.signedUrl,
      });
    }

    const form = new FormData();
    form.append("papers", JSON.stringify(signedPapers));

    const resp = await fetch(modalUrl, {
      method: "POST",
      body: form,
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

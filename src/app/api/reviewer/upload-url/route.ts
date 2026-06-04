// src/app/api/reviewer/upload-url/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function sanitizeFileName(name: string): string {
  const fallback = "paper.pdf";
  const raw = (name || fallback).trim() || fallback;
  const cleaned = raw
    .replace(/[\\/]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 120);
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fileName = sanitizeFileName(String(body.fileName || "paper.pdf"));
    const contentType = String(body.contentType || "application/pdf");

    if (contentType !== "application/pdf" && !fileName.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ ok: false, error: "仅支持 PDF 文件" }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.REVIEW_STORAGE_BUCKET || "review-pdfs";
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ ok: false, error: "缺少 Supabase 服务端环境变量" }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const today = new Date().toISOString().slice(0, 10);
    const id = crypto.randomUUID();
    const path = `review/main/${today}/${id}-${fileName}`;

    const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path, {
      upsert: false,
    });
    if (error || !data?.token) {
      return NextResponse.json({ ok: false, error: error?.message || "创建 Supabase 上传签名失败" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, bucket, path, token: data.token });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "创建上传 URL 失败" }, { status: 500 });
  }
}

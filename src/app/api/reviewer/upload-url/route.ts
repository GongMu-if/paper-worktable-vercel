// src/app/api/reviewer/upload-url/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function sanitizeFileName(name: string): string {
  const fallback = "paper.pdf";
  const raw = (name || fallback).trim() || fallback;

  const cleaned = raw
    .replace(/[\\/]/g, "-")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 120);

  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

function sanitizePathSegment(value: string): string {
  const raw = (value || "").trim();

  const cleaned = raw
    .normalize("NFKD")
    .replace(/[\\/]/g, "-")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleaned || "user";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // fileName 只用于展示/传给后端，不再拼进 Storage path
    const fileName = sanitizeFileName(String(body.fileName || "paper.pdf"));
    const contentType = String(body.contentType || "application/pdf");
    const rawUserId = String(body.userId || body.user_id || "").trim();

    if (!rawUserId) {
      return NextResponse.json(
        { ok: false, error: "请先输入账号名登录" },
        { status: 401 },
      );
    }

    const userId = sanitizePathSegment(rawUserId);

    if (
      contentType !== "application/pdf" &&
      !fileName.toLowerCase().endsWith(".pdf")
    ) {
      return NextResponse.json(
        { ok: false, error: "仅支持 PDF 文件" },
        { status: 400 },
      );
    }

    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.REVIEW_STORAGE_BUCKET || "review-pdfs";

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { ok: false, error: "缺少 Supabase 服务端环境变量" },
        { status: 500 },
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const today = new Date().toISOString().slice(0, 10);
    const id = crypto.randomUUID();

    // Storage path 只使用安全 ASCII 字符，不再拼接中文文件名。
    // 按账号名分区，便于不同账号隔离文件和历史记录。
    const path = `review/${userId}/main/${today}/${id}.pdf`;

    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUploadUrl(path, {
        upsert: false,
      });

    if (error || !data?.token) {
      return NextResponse.json(
        {
          ok: false,
          error: error?.message || "创建 Supabase 上传签名失败",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      bucket,
      path,
      token: data.token,
      originalFileName: fileName,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "创建上传 URL 失败",
      },
      { status: 500 },
    );
  }
}

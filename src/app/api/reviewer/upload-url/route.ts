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

    // 这个 fileName 只用于展示/传给后端，不再拼进 Storage path
    const fileName = sanitizeFileName(String(body.fileName || "paper.pdf"));
    const contentType = String(body.contentType || "application/pdf");
    const userId = sanitizePathSegment(String(body.userId || body.user_id || "anonymous"));

    if (
      contentType !== "application/pdf" &&
      !fileName.toLowerCase().endsWith(".pdf")
    ) {
      return NextResponse.json(
        { ok: false, error: "仅支持 PDF 文件" },
        { status: 400 }
      );
    }

    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.REVIEW_STORAGE_BUCKET || "review-pdfs";

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { ok: false, error: "缺少 Supabase 服务端环境变量" },
        { status: 500 }
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

    // 关键修改：
    // Storage path 只使用安全 ASCII 字符，不再拼接中文文件名
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
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      bucket,
      path,
      token: data.token,

      // 可选返回：方便调试，前端不使用也没关系
      originalFileName: fileName,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "创建上传 URL 失败",
      },
      { status: 500 }
    );
  }
}

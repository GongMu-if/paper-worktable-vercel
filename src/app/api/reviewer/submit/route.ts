// src/app/api/reviewer/submit/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SubmittedPaper = {
  fileName: string;
  bucket: string;
  storagePath: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const papers = Array.isArray(body.papers) ? body.papers : [];
    const userId = String(body.userId || body.user_id || "anonymous").trim() || "anonymous";

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

    const normalizedPapers: SubmittedPaper[] = papers.map((item: any) => ({
      fileName: String(item.fileName || item.file_name || "paper.pdf"),
      bucket: String(item.bucket || defaultBucket),
      storagePath: String(item.storagePath || item.storage_path || ""),
    }));

    const missingPathPaper = normalizedPapers.find((item) => !item.storagePath);
    if (missingPathPaper) {
      return NextResponse.json(
        { ok: false, error: `${missingPathPaper.fileName} 缺少 storagePath` },
        { status: 400 },
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Create signed URLs concurrently instead of waiting for every paper serially.
    const signedPapers = await Promise.all(
      normalizedPapers.map(async (item) => {
        const { data, error } = await admin.storage
          .from(item.bucket)
          .createSignedUrl(item.storagePath, 60 * 60 * 24);

        if (error || !data?.signedUrl) {
          throw new Error(
            `创建 ${item.fileName} 的下载签名失败：${error?.message || "unknown error"}`,
          );
        }

        return {
          file_name: item.fileName,
          bucket: item.bucket,
          storage_path: item.storagePath,
          file_url: data.signedUrl,
        };
      }),
    );

    const form = new FormData();
    form.append("papers", JSON.stringify(signedPapers));
    form.append("user_id", userId);

    // The Modal endpoint should now return quickly. This timeout prevents an
    // indefinitely pending request and converts connection failures into a
    // visible JSON error response.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45_000);

    let resp: Response;
    try {
      resp = await fetch(modalUrl, {
        method: "POST",
        body: form,
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      });
    } catch (error: any) {
      const isAbort = error?.name === "AbortError";
      return NextResponse.json(
        {
          ok: false,
          error: isAbort
            ? "Modal 提交接口响应超时，请检查 Modal 部署状态和日志"
            : `无法连接 Modal 提交接口：${error?.message || "fetch failed"}`,
        },
        { status: isAbort ? 504 : 502 },
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const raw = await resp.text();
    let json: any = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: `Modal 返回了非 JSON 响应：HTTP ${resp.status}，${raw.slice(0, 500)}`,
        },
        { status: 502 },
      );
    }

    if (!resp.ok || !json.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: json.error || `Modal 审稿任务提交失败：HTTP ${resp.status}`,
        },
        { status: resp.status >= 400 && resp.status < 600 ? resp.status : 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      jobId: json.jobId,
      paperCount: json.paperCount,
      dispatchMode: json.dispatchMode,
      userId: json.userId || userId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "提交审稿任务失败" },
      { status: 500 },
    );
  }
}

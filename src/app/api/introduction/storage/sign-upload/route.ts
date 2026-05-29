import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type": "application/json; charset=utf-8"},
  });
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceRoleKey) {
    throw new Error("缺少 SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const bucket = String(body?.bucket || process.env.INTRO_STORAGE_BUCKET || "intro-pdfs");
    const path = String(body?.path || "");
    const contentType = String(body?.content_type || "application/pdf");

    if (!path.trim()) {
      return jsonResponse({status: "error", message: "缺少 storage path。"}, 400);
    }

    if (!path.toLowerCase().endsWith(".pdf")) {
      return jsonResponse({status: "error", message: "只允许上传 PDF 文件。"}, 400);
    }

    const supabase = getAdminClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path, { upsert: false });

    if (error) {
      return jsonResponse({status: "error", message: error.message}, 500);
    }

    return jsonResponse({
      status: "ok",
      data: {
        path,
        token: data?.token,
        signedUrl: data?.signedUrl,
        contentType,
      },
    });
  } catch (error) {
    return jsonResponse({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
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
    const bucket = String(body?.bucket || process.env.ANALYSIS_STORAGE_BUCKET || "analysis-pdfs");
    const path = String(body?.path || "");
    const expiresIn = Number(body?.expires_in || 60 * 60 * 24);

    if (!path.trim()) {
      return jsonResponse({ status: "error", message: "缺少 storage path。" }, 400);
    }

    const supabase = getAdminClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn, { download: true });

    if (error) {
      return jsonResponse({ status: "error", message: error.message }, 500);
    }

    return jsonResponse({
      status: "ok",
      data: {
        path,
        signedUrl: data?.signedUrl,
        expiresIn,
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}

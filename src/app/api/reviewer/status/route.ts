// src/app/api/reviewer/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("jobId") || "";
    const userId = req.nextUrl.searchParams.get("userId") || req.nextUrl.searchParams.get("user_id") || "";
    if (!jobId) {
      return NextResponse.json({ ok: false, error: "缺少 jobId" }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ ok: false, error: "缺少 Supabase 服务端环境变量" }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let jobQuery = admin
      .from("review_jobs")
      .select("*")
      .eq("id", jobId);

    if (userId) {
      jobQuery = jobQuery.eq("user_id", userId);
    }

    const { data: job, error: jobError } = await jobQuery.single();
    if (jobError || !job) {
      return NextResponse.json({ ok: false, error: jobError?.message || "任务不存在" }, { status: 404 });
    }

    const { data: papers, error: papersError } = await admin
      .from("review_papers")
      .select("id, job_id, paper_index, file_name, status, message, formatted_review, error, updated_at")
      .eq("job_id", jobId)
      .order("paper_index", { ascending: true });
    if (papersError) {
      return NextResponse.json({ ok: false, error: papersError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, job, papers: papers || [] });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "获取状态失败" }, { status: 500 });
  }
}

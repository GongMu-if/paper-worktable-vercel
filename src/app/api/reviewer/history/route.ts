// src/app/api/reviewer/history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId") || req.nextUrl.searchParams.get("user_id") || "anonymous";
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") || 20);
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 20, 50));

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ ok: false, error: "缺少 Supabase 服务端环境变量" }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: jobs, error: jobsError } = await admin
      .from("review_jobs")
      .select("id, user_id, status, message, paper_count, completed_count, failed_count, final_result, created_at, updated_at, completed_at")
      .eq("user_id", userId || "anonymous")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (jobsError) {
      return NextResponse.json({ ok: false, error: jobsError.message }, { status: 500 });
    }

    const jobIds = (jobs || []).map((job: any) => job.id).filter(Boolean);
    let papers: any[] = [];
    if (jobIds.length) {
      const { data: paperRows, error: papersError } = await admin
        .from("review_papers")
        .select("id, job_id, paper_index, file_name, status, message, formatted_review, error, updated_at, completed_at")
        .in("job_id", jobIds)
        .order("paper_index", { ascending: true });

      if (papersError) {
        return NextResponse.json({ ok: false, error: papersError.message }, { status: 500 });
      }
      papers = paperRows || [];
    }

    const papersByJob = new Map<string, any[]>();
    for (const paper of papers) {
      const list = papersByJob.get(paper.job_id) || [];
      list.push(paper);
      papersByJob.set(paper.job_id, list);
    }

    const result = (jobs || []).map((job: any) => ({
      ...job,
      papers: papersByJob.get(job.id) || [],
    }));

    return NextResponse.json({ ok: true, userId: userId || "anonymous", jobs: result });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "获取历史审稿记录失败" }, { status: 500 });
  }
}

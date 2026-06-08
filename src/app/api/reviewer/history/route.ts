// src/app/api/reviewer/history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeUserId(value: string) {
  const userId = String(value || "").trim();
  const loweredUserId = userId.toLowerCase();
  if (!userId || loweredUserId === "anonymous" || loweredUserId === "legacy_anonymous") {
    return "";
  }
  return userId;
}

function getAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("缺少 Supabase 服务端环境变量");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(req: NextRequest) {
  try {
    const userId = normalizeUserId(
      req.nextUrl.searchParams.get("userId") || req.nextUrl.searchParams.get("user_id") || "",
    );
    if (!userId) {
      return NextResponse.json({ ok: false, error: "请先输入有效账号名登录，不能使用 anonymous" }, { status: 401 });
    }
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") || 20);
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 20, 50));

    const admin = getAdminClient();

    const { data: jobs, error: jobsError } = await admin
      .from("review_jobs")
      .select("id, user_id, status, message, paper_count, completed_count, failed_count, final_result, created_at, updated_at, completed_at")
      .eq("user_id", userId)
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

    return NextResponse.json({ ok: true, userId, jobs: result });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "获取历史审稿记录失败" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = normalizeUserId(
      body.userId ||
        body.user_id ||
        req.nextUrl.searchParams.get("userId") ||
        req.nextUrl.searchParams.get("user_id") ||
        "",
    );
    if (!userId) {
      return NextResponse.json({ ok: false, error: "请先输入有效账号名登录，不能使用 anonymous" }, { status: 401 });
    }

    const admin = getAdminClient();
    const clearAll = Boolean(body.clearAll || body.clear_all);
    const jobId = String(body.jobId || body.job_id || req.nextUrl.searchParams.get("jobId") || "").trim();

    if (clearAll) {
      const { data: jobs, error: selectError } = await admin
        .from("review_jobs")
        .select("id")
        .eq("user_id", userId);

      if (selectError) {
        return NextResponse.json({ ok: false, error: selectError.message }, { status: 500 });
      }

      const jobIds = (jobs || []).map((job: any) => job.id).filter(Boolean);
      if (!jobIds.length) {
        return NextResponse.json({ ok: true, userId, deletedJobs: 0, deletedPapers: 0 });
      }

      const { count: deletedPapers, error: paperDeleteError } = await admin
        .from("review_papers")
        .delete({ count: "exact" })
        .in("job_id", jobIds);

      if (paperDeleteError) {
        return NextResponse.json({ ok: false, error: paperDeleteError.message }, { status: 500 });
      }

      const { count: deletedJobs, error: jobDeleteError } = await admin
        .from("review_jobs")
        .delete({ count: "exact" })
        .eq("user_id", userId);

      if (jobDeleteError) {
        return NextResponse.json({ ok: false, error: jobDeleteError.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        userId,
        deletedJobs: deletedJobs || 0,
        deletedPapers: deletedPapers || 0,
      });
    }

    if (!jobId) {
      return NextResponse.json({ ok: false, error: "缺少要删除的历史记录 ID" }, { status: 400 });
    }

    const { data: job, error: jobError } = await admin
      .from("review_jobs")
      .select("id")
      .eq("id", jobId)
      .eq("user_id", userId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ ok: false, error: jobError?.message || "历史记录不存在或无权删除" }, { status: 404 });
    }

    const { count: deletedPapers, error: paperDeleteError } = await admin
      .from("review_papers")
      .delete({ count: "exact" })
      .eq("job_id", jobId);

    if (paperDeleteError) {
      return NextResponse.json({ ok: false, error: paperDeleteError.message }, { status: 500 });
    }

    const { count: deletedJobs, error: jobDeleteError } = await admin
      .from("review_jobs")
      .delete({ count: "exact" })
      .eq("id", jobId)
      .eq("user_id", userId);

    if (jobDeleteError) {
      return NextResponse.json({ ok: false, error: jobDeleteError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      userId,
      jobId,
      deletedJobs: deletedJobs || 0,
      deletedPapers: deletedPapers || 0,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "删除历史审稿记录失败" }, { status: 500 });
  }
}

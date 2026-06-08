// src/lib/reviewerApi.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export type ReviewUploadMeta = {
  fileName: string;
  bucket: string;
  storagePath: string;
};

export type ReviewPaperStatus = {
  id: string;
  job_id: string;
  paper_index: number;
  file_name: string;
  status: string;
  message?: string | null;
  formatted_review?: string | null;
  error?: string | null;
};

export type ReviewJobStatus = {
  job: {
    id: string;
    user_id?: string | null;
    status: string;
    message?: string | null;
    paper_count: number;
    completed_count: number;
    failed_count: number;
    final_result?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    completed_at?: string | null;
  };
  papers: ReviewPaperStatus[];
};

export type ReviewHistoryJob = ReviewJobStatus["job"] & {
  papers?: ReviewPaperStatus[];
};

function assertPdf(file: File) {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".pdf") && file.type !== "application/pdf") {
    throw new Error(`${file.name} 不是 PDF 文件`);
  }
}

function normalizeReviewerUserId(userId: string): string {
  const user = String(userId || "").trim();
  const lowered = user.toLowerCase();
  if (!user || lowered === "anonymous" || lowered === "legacy_anonymous") {
    throw new Error("请先输入有效账号名登录，不能使用 anonymous");
  }
  return user;
}

export function getReviewerSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

export async function uploadReviewerPdf(file: File, userId: string): Promise<ReviewUploadMeta> {
  assertPdf(file);
  const currentUser = normalizeReviewerUserId(userId);
  const res = await fetch("/api/reviewer/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || "application/pdf",
      userId: currentUser,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "创建上传 URL 失败");
  }

  const supabase = getReviewerSupabaseClient();
  const { error } = await supabase.storage
    .from(json.bucket)
    .uploadToSignedUrl(json.path, json.token, file, {
      contentType: file.type || "application/pdf",
    });

  if (error) {
    throw new Error(`上传 ${file.name} 失败：${error.message}`);
  }

  return {
    fileName: file.name,
    bucket: json.bucket,
    storagePath: json.path,
  };
}

export async function submitReviewerJob(files: ReviewUploadMeta[], userId: string): Promise<{ jobId: string }> {
  const currentUser = normalizeReviewerUserId(userId);
  const res = await fetch("/api/reviewer/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ papers: files, userId: currentUser }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "提交审稿任务失败");
  }
  return { jobId: json.jobId };
}

export async function fetchReviewerJob(jobId: string, userId: string): Promise<ReviewJobStatus> {
  const currentUser = normalizeReviewerUserId(userId);
  const query = new URLSearchParams({ jobId, userId: currentUser });
  const res = await fetch(`/api/reviewer/status?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "获取审稿任务状态失败");
  }
  return { job: json.job, papers: json.papers || [] };
}


export async function listReviewerHistory(userId: string, limit = 20): Promise<ReviewHistoryJob[]> {
  const currentUser = String(userId || "").trim();
  if (!currentUser) return [];
  const query = new URLSearchParams({
    userId: currentUser,
    limit: String(limit || 20),
  });
  const res = await fetch(`/api/reviewer/history?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "获取历史审稿记录失败");
  }
  return json.jobs || [];
}

export async function deleteReviewerHistoryJob(
  userId: string,
  jobId: string,
): Promise<{ deletedJobs: number; deletedPapers: number }> {
  const currentUser = normalizeReviewerUserId(userId);
  const currentJobId = String(jobId || "").trim();
  if (!currentJobId) {
    throw new Error("缺少要删除的历史记录 ID");
  }

  const res = await fetch("/api/reviewer/history", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ userId: currentUser, jobId: currentJobId }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "删除历史审稿记录失败");
  }
  return {
    deletedJobs: Number(json.deletedJobs || 0),
    deletedPapers: Number(json.deletedPapers || 0),
  };
}

export async function clearReviewerHistory(
  userId: string,
): Promise<{ deletedJobs: number; deletedPapers: number }> {
  const currentUser = normalizeReviewerUserId(userId);
  const res = await fetch("/api/reviewer/history", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ userId: currentUser, clearAll: true }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "清空历史审稿记录失败");
  }
  return {
    deletedJobs: Number(json.deletedJobs || 0),
    deletedPapers: Number(json.deletedPapers || 0),
  };
}

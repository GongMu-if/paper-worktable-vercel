import type {
  AgentLog,
  AnalysisResult,
  AuthResult,
  PublicConfig,
  ReportMeta,
  ReportRecord,
  RpcEnvelope,
  SearchMeta,
  SearchRecord,
} from "./types";

function formatRpcError(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return value.message;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function parseJsonResponse<T>(response: Response, context: string): Promise<T> {
  let payload: RpcEnvelope<T> | Record<string, unknown>;

  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`${context} 返回了无法解析的响应：${formatRpcError(error)}`);
  }

  if (!response.ok) {
    const message =
      (payload as RpcEnvelope<T>).message ||
      (payload as RpcEnvelope<T>).error ||
      `HTTP ${response.status}`;

    throw new Error(`${context} 失败：${formatRpcError(message)}`);
  }

  if ((payload as RpcEnvelope<T>).status && (payload as RpcEnvelope<T>).status !== "ok") {
    const message =
      (payload as RpcEnvelope<T>).message ||
      (payload as RpcEnvelope<T>).error ||
      `${context} 执行失败`;

    throw new Error(`${context} 失败：${formatRpcError(message)}`);
  }

  return ((payload as RpcEnvelope<T>).data ?? payload) as T;
}

export async function backendRpc<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, payload }),
  });
  return parseJsonResponse<T>(response, `后端 RPC ${action}`);
}

export async function ensureAppStorage(): Promise<boolean> {
  return backendRpc<boolean>("ensure_app_storage");
}

export async function getPublicBackendConfig(): Promise<PublicConfig> {
  return backendRpc<PublicConfig>("public_config");
}

export async function getWorkbenchBootstrap(username: string): Promise<{
  config: PublicConfig;
  reports: ReportMeta[];
  searches: SearchMeta[];
}> {
  return backendRpc<{ config: PublicConfig; reports: ReportMeta[]; searches: SearchMeta[] }>(
    "workbench_bootstrap",
    { username },
  );
}

export async function loadReportViewBundle(username: string, reportId: string): Promise<{
  meta: ReportMeta | null;
  payload: ReportRecord | null;
  logs: AgentLog[];
}> {
  return backendRpc<{ meta: ReportMeta | null; payload: ReportRecord | null; logs: AgentLog[] }>(
    "load_report_view",
    { username, report_id: reportId },
  );
}

export async function normalizeReportMarkdown(mdText: string): Promise<string> {
  return backendRpc<string>("normalize_report_markdown", { md_text: mdText || "" });
}

export async function registerUser(username: string, password: string): Promise<AuthResult> {
  return backendRpc<AuthResult>("register_user", { username, password });
}

export async function authenticateUser(username: string, password: string): Promise<AuthResult> {
  return backendRpc<AuthResult>("authenticate_user", { username, password });
}

export async function loadUserReportIndex(username: string): Promise<ReportMeta[]> {
  return backendRpc<ReportMeta[]>("load_user_report_index", { username });
}

export async function getUserJobState(username: string, reportId: string): Promise<ReportMeta | null> {
  return backendRpc<ReportMeta | null>("get_user_job_state", { username, report_id: reportId });
}

export async function getUserJobByCacheKey(username: string, cacheKey: string): Promise<ReportMeta | null> {
  return backendRpc<ReportMeta | null>("get_user_job_by_cache_key", { username, cache_key: cacheKey });
}

export async function updateAnalysisJobStatus(jobId: string, status: string, progressText: string): Promise<boolean> {
  return backendRpc<boolean>("update_analysis_job_status", { job_id: jobId, status, progress_text: progressText });
}

export async function createOrReuseAnalysisJob(
  username: string,
  sourceName: string,
  cacheKey: string,
): Promise<{ job: ReportMeta; should_submit: boolean }> {
  return backendRpc<{ job: ReportMeta; should_submit: boolean }>("create_or_reuse_analysis_job", {
    username,
    source_name: sourceName,
    cache_key: cacheKey,
  });
}

export async function loadAgentLogs(username: string, reportId: string): Promise<AgentLog[]> {
  return backendRpc<AgentLog[]>("load_agent_logs", { username, report_id: reportId });
}

export async function loadUserReportRecord(username: string, reportId: string): Promise<ReportRecord | null> {
  return backendRpc<ReportRecord | null>("load_user_report_record", { username, report_id: reportId });
}

export async function getUserCachedReport(username: string, cacheKey: string): Promise<AnalysisResult | null> {
  return backendRpc<AnalysisResult | null>("get_user_cached_report", { username, cache_key: cacheKey });
}

export async function submitAnalysisJob(jobId: string, sourceName: string, cacheKey: string, file: File): Promise<Record<string, unknown>> {
  const directUploadUrl = process.env.NEXT_PUBLIC_DIRECT_ANALYSIS_UPLOAD_URL;
  const formData = new FormData();
  formData.append("job_id", jobId);
  formData.append("source_name", sourceName || "未命名论文");
  formData.append("cache_key", cacheKey);
  formData.append("file", file, file.name || "paper.pdf");

  const response = await fetch(directUploadUrl || "/api/analysis-upload", {
    method: "POST",
    body: formData,
  });

  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(formatRpcError(result?.message || result?.error || `HTTP ${response.status}`));
  }
  const status = String(result?.status || "");
  if (!["accepted", "queued", "processing", "ok"].includes(status)) {
    throw new Error(formatRpcError(result?.message || result?.error || "后端解析任务未被接受。"));
  }
  return result || {};
}

export async function loadUserSearchIndex(username: string): Promise<SearchMeta[]> {
  return backendRpc<SearchMeta[]>("load_user_search_index", { username });
}

export async function getUserSearchJobState(username: string, searchJobId: string): Promise<SearchMeta | null> {
  return backendRpc<SearchMeta | null>("get_user_search_job_state", { username, search_job_id: searchJobId });
}

export async function loadUserSearchRecord(username: string, searchJobId: string): Promise<SearchRecord | null> {
  return backendRpc<SearchRecord | null>("load_user_search_record", { username, search_job_id: searchJobId });
}

export async function createPaperSearchJob(args: {
  username: string;
  userTopic: string;
  userRequirements: string;
  preprintRule: string;
  feedback?: string;
  previousResult?: string;
}): Promise<SearchMeta> {
  return backendRpc<SearchMeta>("create_paper_search_job", {
    username: args.username,
    user_topic: args.userTopic,
    user_requirements: args.userRequirements,
    preprint_rule: args.preprintRule,
    feedback: args.feedback || "",
    previous_result: args.previousResult || "",
  });
}

export async function updatePaperSearchJobStatus(searchJobId: string, status: string, progressText: string): Promise<boolean> {
  return backendRpc<boolean>("update_paper_search_job_status", {
    search_job_id: searchJobId,
    status,
    progress_text: progressText,
  });
}

export async function markPaperSearchJobSuperseded(searchJobId: string, supersededBy: string): Promise<boolean> {
  return backendRpc<boolean>("mark_paper_search_job_superseded", {
    search_job_id: searchJobId,
    superseded_by: supersededBy,
  });
}

export async function submitPaperSearchJob(searchJobId: string): Promise<Record<string, unknown>> {
  return backendRpc<Record<string, unknown>>("submit_paper_search_job", { search_job_id: searchJobId });
}

export async function finalizePaperSearchJob(searchJobId: string): Promise<Record<string, unknown>> {
  return backendRpc<Record<string, unknown>>("finalize_paper_search_job", { search_job_id: searchJobId });
}

export type RpcEnvelope<T> = {
  status: "ok" | "error" | string;
  data?: T;
  message?: string;
  error?: string;
};

export type AuthResult = {
  ok: boolean;
  result: string;
};

export type PublicConfig = {
  analysis_cache_version: string;
};

export type ReportMeta = {
  report_id: string;
  cache_key?: string;
  source_name?: string;
  report_title?: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
  progress_text?: string;
  has_report?: boolean;
  task_no?: number;
};

export type SearchMeta = {
  search_job_id: string;
  topic?: string;
  requirements?: string;
  preprint_rule?: string;
  feedback?: string;
  status?: string;
  progress_text?: string;
  is_final?: boolean;
  finalized_at?: string;
  superseded_by?: string;
  created_at?: string;
  updated_at?: string;
  has_result?: boolean;
};

export type AnalysisResult = {
  source_markdown?: string;
  text_report?: string;
  vision_summaries?: string;
  images?: Record<string, string>;
  main_report?: string;
  agent_state?: Record<string, unknown>;
};

export type ReportRecord = {
  meta: ReportMeta;
  analysis_result: AnalysisResult;
};

export type SearchRecord = {
  meta: SearchMeta;
  result_markdown: string;
  agent_logs: Array<Record<string, unknown>>;
  raw_payload: Record<string, unknown>;
};

export type AgentLog = {
  step_no?: number;
  actor?: string;
  action?: string;
  reason?: string;
  instructions?: string;
  expected_output?: string;
  status?: string;
  details?: unknown;
  created_at?: string;
};

export type BatchRow = {
  index: number;
  source_name: string;
  cache_key: string;
  report_id?: string;
  status: string;
  progress_text: string;
};

export type ReadyReport = {
  index: number;
  source_name: string;
  cache_key: string;
  analysis_result: AnalysisResult;
  result_source: string;
};

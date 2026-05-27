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


export type IntroductionMeta = {
  id: string;
  title?: string;
  status?: string;
  progress_text?: string;
  has_seed_pdf?: boolean;
  seed_pdf_name?: string;
  has_user_innovation?: boolean;
  target_language?: string;
  target_words?: number | string | null;
  created_at?: string;
  updated_at?: string;
};

export type IntroductionRecord = IntroductionMeta & {
  problem_card?: Record<string, unknown> | string | null;
  search_query_pack?: Record<string, unknown> | string | null;
  search_results_markdown?: string;
  search_candidate_papers?: Array<Record<string, unknown>>;
  reference_papers?: Array<Record<string, unknown>>;
  literature_cards?: Array<Record<string, unknown>>;
  gap_report?: string | Record<string, unknown> | null;
  innovation_candidates?: Array<Record<string, unknown>>;
  selected_innovations?: Array<Record<string, unknown>>;
  innovation_validation_report?: string | Record<string, unknown> | null;
  template_analysis?: string | Record<string, unknown> | null;
  intro_plan?: string | Record<string, unknown> | null;
  intro_draft?: string;
  intro_review_report?: string | Record<string, unknown> | null;
  final_introduction?: string;
  agent_logs?: Array<Record<string, unknown>>;
  raw_payload?: Record<string, unknown>;
};

export type IntroductionSubmitArgs = {
  username: string;
  title?: string;
  hasSeedPdf: boolean;
  manualProblemText?: string;
  taskGoal?: string;
  taskGranularity?: string;
  researchObject?: string;
  inputOutput?: string;
  hasUserInnovation: boolean;
  userInnovationText?: string;
  targetLanguage?: string;
  targetWords?: string;
};

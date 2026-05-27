"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  authenticateUser,
  createOrReuseAnalysisJob,
  createPaperSearchJob,
  ensureAppStorage,
  finalizePaperSearchJob,
  getPublicBackendConfig,
  getUserJobState,
  getUserSearchJobState,
  getUserIntroductionJobState,
  loadAgentLogs,
  loadUserReportIndex,
  loadUserReportRecord,
  loadUserIntroductionIndex,
  loadUserIntroductionRecord,
  loadUserSearchIndex,
  loadUserSearchRecord,
  markPaperSearchJobSuperseded,
  registerUser,
  selectIntroductionInnovations,
  submitAnalysisJob,
  submitIntroductionJob,
  submitPaperSearchJob,
  updateAnalysisJobStatus,
  updatePaperSearchJobStatus,
  uploadIntroductionReferences,
} from "@/lib/api";
import { buildExportFilename, getPdfCacheKey } from "@/lib/hash";
import type { AgentLog, AnalysisResult, BatchRow, IntroductionMeta, IntroductionRecord, ReadyReport, ReportMeta, SearchMeta, SearchRecord } from "@/lib/types";
import { MarkdownReport } from "./MarkdownReport";

const JOB_STATUS_REFRESH_INTERVAL_MS = 180000;
const DEFAULT_PREPRINT_RULE = "排除预印本 (仅限正规期刊/会议)";
const MAX_ANALYSIS_SUBMIT_CONCURRENCY = 1; // 原 PDF 解析 API 不稳定时保持 1；确认服务支持后可改为 2。

type AppState = "IDLE" | "SEARCH_RUNNING" | "WAITING_FEEDBACK" | "COMPLETED";
type IntroSourceMode = "pdf" | "manual";
type IntroInnovationMode = "existing" | "generate";
type AuthMode = "login" | "register";
type MainView =
  | { type: "workspace" }
  | { type: "report"; reportId: string }
  | { type: "search"; searchJobId: string }
  | { type: "introduction"; introJobId: string }
  | { type: "analysis-batch"; files: File[] };

type SearchContext = {
  topic: string;
  requirements: string;
  preprintRule: string;
};

function normalizeUsername(username: string): string {
  return (username || "").trim();
}

function canonicalUsername(username: string): string {
  return normalizeUsername(username).toLowerCase();
}

function shorten(text: string, maxLen = 18): string {
  const value = (text || "").trim();
  if (value.length <= maxLen) return value;
  return `${value.slice(0, Math.max(1, maxLen - 1))}…`;
}

function searchHistoryLabel(meta: SearchMeta): string {
  const topic = shorten(meta.topic || "论文检索", 18);
  const status = (meta.status || "").toLowerCase();
  if (["queued", "processing"].includes(status)) return `${topic}｜检索中`;
  if (status === "failed") return `${topic}｜检索失败`;
  if (status === "finished" && !meta.is_final) return `${topic}｜待最终确认`;
  const timestamp = (meta.finalized_at || meta.updated_at || meta.created_at || "").slice(0, 16);
  return timestamp ? `${topic}｜${timestamp}` : topic;
}

function introductionHistoryLabel(meta: IntroductionMeta): string {
  const title = shorten(meta.title || "Introduction 写作", 18);
  const status = (meta.status || "").toLowerCase();
  if (["queued", "processing"].includes(status)) return `${title}｜写作中`;
  if (status === "waiting_reference_upload") return `${title}｜待上传参考论文`;
  if (status === "waiting_innovation_selection") return `${title}｜待选择创新点`;
  if (status === "failed") return `${title}｜任务失败`;
  const timestamp = (meta.updated_at || meta.created_at || "").slice(0, 16);
  return timestamp ? `${title}｜${timestamp}` : title;
}

function introductionStatusText(status?: string): string {
  const value = (status || "").toLowerCase();
  if (value === "queued") return "排队中";
  if (value === "processing") return "后台写作中";
  if (value === "waiting_reference_upload") return "等待上传参考论文";
  if (value === "waiting_innovation_selection") return "等待选择创新点";
  if (value === "finished") return "已完成";
  if (value === "failed") return "失败";
  return status || "未知状态";
}

function renderValueAsMarkdown(value: unknown, fallback = "暂无内容。"): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  try {
    return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
  } catch {
    return String(value) || fallback;
  }
}

function innovationCandidateTitle(item: Record<string, unknown>, index: number): string {
  const title =
    item.title ||
    item.name ||
    item.innovation_name ||
    item["创新点名称"] ||
    item["创新点"];
  return String(title || `创新点候选 ${index + 1}`);
}

const INTRO_FIELD_LABELS: Record<string, string> = {
  seed_problem_card: "研究问题卡",
  problem_card: "研究问题卡",
  search_query_pack: "搜索关键词与筛选要求",
  search_results_markdown: "搜索结果",
  literature_cards: "参考论文分析卡片",
  gap_report: "领域痛点与普遍不足",
  innovation_candidates: "创新点候选",
  innovation_validation_report: "创新点验证报告",
  intro_plan: "Introduction 大纲",
  intro_draft: "Introduction 初稿",
  intro_review_report: "Reviewer 审查报告",
  final_introduction: "最终 Introduction",

  task_signature: "任务签名",
  task_name: "任务名称",
  task_family: "任务族",
  research_domain: "研究领域",
  research_object: "研究对象",
  target_entity: "目标实体",
  target_entity_scope: "目标实体范围",
  task_granularity: "任务粒度",
  task_goal: "任务目标",
  input_space: "输入空间",
  output_space: "输出空间",
  evaluation_target: "评价目标",

  problem_boundary: "问题边界",
  same_problem_must_have: "同问题必须满足",
  same_problem_should_have: "同问题最好满足",
  full_same_problem_must_have: "完全同问题必须满足",
  same_task_family_but_not_same_problem: "同任务族但非同问题",
  related_but_not_same: "相关但不同问题",
  must_exclude: "必须排除",
  must_exclude_as_main_reference: "不能作为主参考",

  method_signature: "方法特征",
  seed_method_route: "种子论文方法路线",
  model_scope: "模型适用范围",
  learning_paradigm: "学习范式",
  key_modules: "关键模块",
  data_dependency: "数据依赖",
  training_objective: "训练目标",
  special_designs: "特殊设计",

  reference_search_intent: "参考论文检索意图",
  desired_reference_type: "期望参考论文类型",
  preferred_method_scope: "优先方法范围",
  main_reference_must_match: "主参考必须匹配",
  must_compare_against: "应优先对比的路线",
  baseline_or_background_only: "仅作基线或背景",
  use_as_background_only: "仅作背景参考",
  do_not_use_as_main_reference: "不能作为主参考",

  gap_signature: "缺口特征",
  claimed_contributions: "作者声称贡献",
  seed_limitations: "种子论文局限",
  possible_gaps: "可能研究缺口",
  generalizable_gap_keywords: "可泛化缺口关键词",
  innovation_risk_keywords: "创新点风险关键词",

  search_keywords_hint: "检索关键词提示",
  exact_task_queries: "精确任务检索词",
  task_synonym_queries: "任务同义检索词",
  object_synonym_queries: "研究对象同义检索词",
  granularity_queries: "粒度/输入输出检索词",
  method_scope_queries: "方法范围检索词",
  benchmark_or_dataset_queries: "数据集/基准检索词",

  search_topic: "检索主题",
  search_queries: "检索词",
  requirements: "筛选要求",
  preprint_rule: "预印本规则",
  same_problem_criteria: "同问题判断标准",
  preferred_reference_profile: "优先参考论文类型",
  search_coverage_plan: "检索覆盖计划",
  avoid: "排除方向",

  title: "标题",
  name: "名称",
  innovation_name: "创新点名称",
  description: "具体说明",
  rationale: "提出依据",
  novelty: "新颖性",
  feasibility: "可实现性",
  feasibility_level: "可实现性等级",
  risk: "风险",
  risk_level: "风险等级",
  novelty_risk: "新颖性风险",
  implementation_path: "实现路径",
  expected_contribution: "预期贡献",
  relation_to_gap: "对应痛点",
  evidence: "依据",
  reason: "原因",
  confidence: "置信度",
  status: "状态",
  summary: "摘要",
  priority: "优先级",
  main_risk: "主要风险",

  core_idea: "核心思路",
  "core idea": "核心思路",
  target_gap: "针对痛点",
  "target gap": "针对痛点",
  technical_route: "技术路线",
  "technical route": "技术路线",
  needed_experiments: "所需实验",
  "needed experiments": "所需实验",
  reviewer_attack_points: "审稿人可能攻击点",
  "reviewer attack points": "审稿人可能攻击点",
  difference_from_existing_work: "与现有工作的区别",
  "difference from existing work": "与现有工作的区别",
  recommended_intro_positioning: "引言中的推荐定位",
  "recommended intro positioning": "引言中的推荐定位",
  complementary_value: "互补价值",
  "complementary value": "互补价值",
  fusion_strategy: "融合策略",
  "fusion strategy": "融合策略",
  integration_strategy: "融合策略",
  "integration strategy": "融合策略",
  innovation_summary: "创新点概述",
  "innovation summary": "创新点概述",
  experiment_design: "实验设计",
  "experiment design": "实验设计",
  expected_results: "预期结果",
  "expected results": "预期结果",
};

const INTRO_HIDDEN_FIELDS = new Set([
  "id",
  "innovation_id",
  "candidate_id",
  "paper_id",
  "legacy_flat_fields",
  "raw",
  "raw_output",
  "raw_json",
]);

function introLabel(key: string): string {
  return INTRO_FIELD_LABELS[key] || key.replace(/_/g, " ");
}

function stripIntroNoise(text: string): string {
  let value = String(text || "").trim();
  if (!value) return "";

  value = value
    .replace(/<INTRO_[A-Z_]+>/g, "")
    .replace(/<\/INTRO_[A-Z_]+>/g, "")
    .replace(/<INTRO_[A-Z_]+\/>/g, "");

  value = value.replace(
    /^(好的[，,]\s*)?作为\s*(Gap Mining Agent|Search Query Planner Agent|Seed Paper Reader Agent|Reviewer Agent|Writer Agent|Revision Agent|Innovation Generator Agent|Innovation Validator Agent)[，,。\s]*/i,
    "",
  );

  value = value.replace(
    /^我已?经?综合研究问题卡和参考论文卡片[，,。\s]*/i,
    "",
  );

  value = value.replace(
    /^以下是(分析报告|结果|输出|整理后的内容)[：:\s]*/i,
    "",
  );

  return value.trim();
}

function normalizeIntroDisplayValue(key: string, value: string): string {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();
  const normalizedKey = String(key || "").toLowerCase().replace(/\s+/g, "_");

  if (["high", "medium", "low"].includes(lower)) {
    if (["feasibility", "feasibility_level", "priority", "confidence"].includes(normalizedKey)) {
      if (lower === "high") return "高";
      if (lower === "medium") return "中";
      if (lower === "low") return "低";
    }

    if (["risk", "risk_level", "novelty_risk", "main_risk"].includes(normalizedKey)) {
      if (lower === "high") return "高风险";
      if (lower === "medium") return "中风险";
      if (lower === "low") return "低风险";
    }
  }

  return raw;
}

function formatIntroPrimitive(value: unknown, key = ""): string {
  if (value == null) return "";
  if (typeof value === "string") return normalizeIntroDisplayValue(key, stripIntroNoise(value));
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function renderIntroValueAsMarkdown(value: unknown, depth = 0): string {
  if (value == null) return "暂无内容。";

  if (typeof value === "string") {
    return stripIntroNoise(value) || "暂无内容。";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (!value.length) return "暂无内容。";

    return value
      .map((item, index) => {
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          return `${index + 1}. ${formatIntroPrimitive(item)}`;
        }

        if (item && typeof item === "object") {
          return `### ${index + 1}. ${innovationCandidateTitle(item as Record<string, unknown>, index)}\n\n${renderIntroValueAsMarkdown(item, depth + 1)}`;
        }

        return `${index + 1}. ${String(item)}`;
      })
      .join("\n\n");
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const lines: string[] = [];

    for (const [key, raw] of Object.entries(obj)) {
      if (INTRO_HIDDEN_FIELDS.has(key)) continue;
      if (raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0)) continue;

      const label = introLabel(key);

      if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
        const text = formatIntroPrimitive(raw, key);
        if (text) lines.push(`**${label}：** ${text}`);
      } else if (Array.isArray(raw)) {
        const body = raw.length
          ? raw.map((item, index) => {
              if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
                return `${index + 1}. ${formatIntroPrimitive(item, key)}`;
              }
              return `${index + 1}. ${renderIntroValueAsMarkdown(item, depth + 1)}`;
            }).join("\n")
          : "暂无内容。";
        lines.push(`**${label}：**\n\n${body}`);
      } else if (typeof raw === "object") {
        const heading = depth <= 0 ? "##" : "###";
        const nested = renderIntroValueAsMarkdown(raw, depth + 1);
        if (nested && nested !== "暂无内容。") lines.push(`${heading} ${label}\n\n${nested}`);
      }
    }

    return lines.join("\n\n") || "暂无内容。";
  }

  return String(value);
}

function reportHistoryLabel(meta: ReportMeta): string {
  const displayName = meta.source_name || meta.report_title || "未命名论文";
  const shortName = shorten(displayName, 18);
  const status = (meta.status || "").toLowerCase();
  if (["queued", "processing"].includes(status)) return `${shortName}｜正在解析中`;
  if (status === "failed") return `${shortName}｜解析失败`;
  const timestamp = (meta.updated_at || meta.created_at || "").slice(0, 16);
  return timestamp ? `${shortName}｜${timestamp}` : shortName;
}

function parseHistoryTime(value: string | undefined): number {
  const text = (value || "").trim();
  if (!text) return 0;
  const parsed = Date.parse(text.includes("T") ? text : text.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function reportActivityTime(meta: ReportMeta | undefined): number {
  if (!meta) return 0;
  return parseHistoryTime(meta.updated_at || meta.created_at);
}

function searchActivityTime(meta: SearchMeta | undefined): number {
  if (!meta) return 0;
  return parseHistoryTime(meta.finalized_at || meta.updated_at || meta.created_at);
}

function fileIdentity(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function buildSearchUiLogs(searchLogs: Array<Record<string, unknown>>): Array<{ title: string; content: string }> {
  return (searchLogs || []).map((item, index) => {
    const step = String(item.step || index + 1);
    const thoughtAction = String(item.thought_action || item.action || "");
    const observation = String(item.observation || "");
    const contentParts = [];
    if (thoughtAction) contentParts.push(`**检索决策：**\n\n\`\`\`text\n${thoughtAction}\n\`\`\``);
    if (observation) contentParts.push(`**检索工具返回：**\n\n\`\`\`text\n${observation}\n\`\`\``);
    return {
      title: `文献检索 Agent 执行记录（第 ${step} 步）`,
      content: contentParts.join("\n\n") || "无详细日志。",
    };
  });
}

function downloadText(filename: string, text: string, mime = "text/markdown") {
  const blob = new Blob([text || ""], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function LoginCard({ onLogin }: { onLogin: (username: string) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    setBusy(true);
    try {
      await ensureAppStorage();
      if (mode === "register") {
        if (password !== confirm) {
          setError("两次输入的密码不一致。");
          return;
        }
        const result = await registerUser(username, password);
        if (!result.ok) {
          setError(result.result);
          return;
        }
        onLogin(result.result);
      } else {
        const result = await authenticateUser(username, password);
        if (!result.ok) {
          setError(result.result);
          return;
        }
        onLogin(result.result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card stack">
        <div>
          <h1>学术文献智能工作台</h1>
          <p className="muted">请登录研究工作区。系统会为每个账号独立保存文献检索记录与论文精读报告。</p>
        </div>
        <div className="tabs">
          <button className={`tab ${mode === "login" ? "active" : ""}`} onClick={() => setMode("login")}>登录</button>
          <button className={`tab ${mode === "register" ? "active" : ""}`} onClick={() => setMode("register")}>注册</button>
        </div>
        <div className="stack-sm">
          <label className="small">账号</label>
          <input className="input" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入账号" />
        </div>
        <div className="stack-sm">
          <label className="small">密码</label>
          <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" />
        </div>
        {mode === "register" ? (
          <div className="stack-sm">
            <label className="small">确认密码</label>
            <input className="input" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="请再次输入密码" />
          </div>
        ) : null}
        {error ? <div className="notice error">{error}</div> : null}
        <button className="button full" disabled={busy || !username || !password} onClick={submit}>
          {busy ? "处理中..." : mode === "register" ? "注册并进入系统" : "登录"}
        </button>
      </div>
    </div>
  );
}

function Sidebar({
  username,
  reports,
  searches,
  introductions,
  selectedReportId,
  selectedSearchId,
  selectedIntroId,
  onRefresh,
  onLogout,
  onSelectWorkspace,
  onSelectReport,
  onSelectSearch,
  onSelectIntroduction,
}: {
  username: string;
  reports: ReportMeta[];
  searches: SearchMeta[];
  introductions: IntroductionMeta[];
  selectedReportId: string | null;
  selectedSearchId: string | null;
  selectedIntroId: string | null;
  onRefresh: () => void;
  onLogout: () => void;
  onSelectWorkspace: () => void;
  onSelectReport: (id: string) => void;
  onSelectSearch: (id: string) => void;
  onSelectIntroduction: (id: string) => void;
}) {
  return (
    <aside className="sidebar stack">
      <div>
        <h2>工作台</h2>
        <p className="small">当前账号：{username}</p>
        <div className="row-wrap" style={{ marginTop: 10 }}>
          <button className="button secondary" onClick={onRefresh}>刷新</button>
          <button className="button secondary" onClick={onSelectWorkspace}>当前工作区</button>
          <button className="button secondary" onClick={onLogout}>退出</button>
        </div>
      </div>
      <div className="divider" />
      <div>
        <h3>精读报告档案</h3>
        <div className="history-list">
          {reports.length ? reports.map((item) => (
            <button
              key={item.report_id}
              className={`history-item ${selectedReportId === item.report_id ? "active" : ""}`}
              onClick={() => onSelectReport(item.report_id)}
            >
              {reportHistoryLabel(item)}
            </button>
          )) : <p className="small">当前账号暂无精读报告档案。</p>}
        </div>
      </div>
      <div className="divider" />
      <div>
        <h3>文献检索档案</h3>
        <div className="history-list">
          {searches.length ? searches.map((item) => (
            <button
              key={item.search_job_id}
              className={`history-item ${selectedSearchId === item.search_job_id ? "active" : ""}`}
              onClick={() => onSelectSearch(item.search_job_id)}
            >
              {searchHistoryLabel(item)}
            </button>
          )) : <p className="small">当前账号暂无文献检索档案。</p>}
        </div>
      </div>
      <div className="divider" />
      <div>
        <h3>Introduction 写作档案</h3>
        <div className="history-list">
          {introductions.length ? introductions.map((item) => (
            <button
              key={item.id}
              className={`history-item ${selectedIntroId === item.id ? "active" : ""}`}
              onClick={() => onSelectIntroduction(item.id)}
            >
              {introductionHistoryLabel(item)}
            </button>
          )) : <p className="small">当前账号暂无 Introduction 写作档案。</p>}
        </div>
      </div>
      <p className="small">历史报告会长期保留，可在重新登录后继续查看。</p>
    </aside>
  );
}

function AgentLogs({ logs }: { logs: AgentLog[] }) {
  if (!logs.length) return <p className="small">暂无完整 Agent 动作轨迹。</p>;
  return (
    <details className="card-soft">
      <summary>查看完整动作轨迹</summary>
      <div className="stack" style={{ marginTop: 12 }}>
        {logs.map((row, index) => (
          <div key={`${row.step_no}-${index}`} className="card-soft">
            <strong>{row.step_no || index + 1}. {row.actor || "未知执行者"}｜{row.action || "未知动作"}｜{row.status || ""}</strong>
            {row.created_at ? <span className="small">　{row.created_at}</span> : null}
            {row.reason ? <p>- 原因：{row.reason}</p> : null}
            {row.instructions ? <p>- 指令：{row.instructions}</p> : null}
            {row.expected_output ? <p>- 预期输出：{row.expected_output}</p> : null}
            {row.details ? <pre className="log-box">{JSON.stringify(row.details, null, 2)}</pre> : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function AnalysisReportView({ analysisResult, sourceName, cacheKey, statusText = "论文深度透视报告已生成！" }: {
  analysisResult: AnalysisResult;
  sourceName: string;
  cacheKey: string;
  statusText?: string;
}) {
  const reportMd = analysisResult.main_report || "";

  console.log("report image keys:", Object.keys(analysisResult.images || {}));
  console.log(
    "markdown image refs:",
    Array.from(reportMd.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)).map((m) => m[1])
  );
  return (
    <div className="stack">
      <div className="notice success">{statusText}</div>
      <div className="card">
        <MarkdownReport markdown={reportMd} images={analysisResult.images || {}} />
      </div>
      <div className="card">
        <h3>导出</h3>
        <button
          className="button"
          onClick={() => downloadText(buildExportFilename(sourceName, "_论文全维度深度透视报告.md"), reportMd)}
        >
          下载报告原文（Markdown）
        </button>
        <span className="small" style={{ marginLeft: 12 }}>cache_key: {cacheKey.slice(0, 12)}…</span>
      </div>
    </div>
  );
}

function WorkspaceIntro() {
  return (
    <div className="card stack">
      <h2>当前工作区</h2>
      <p>从这里选择你要进行的任务。你可以先输入研究主题进行文献检索，也可以直接上传已有论文进行精读。任务提交后，即使离开页面，稍后重新登录也可以继续查看结果。</p>
      <div className="grid-2">
        <div className="card-soft">
          <h3>文献检索</h3>
          <p className="muted">填写研究主题和筛选要求后，系统会为你查找相关论文，并整理推荐结果。</p>
        </div>
        <div className="card-soft">
          <h3>论文精读</h3>
          <p className="muted">上传论文 PDF 后，系统会生成结构化精读报告，并写入当前账号档案。</p>
        </div>
        <div className="card-soft">
          <h3>Introduction 写作</h3>
          <p className="muted">根据种子论文或手动研究问题，检索同问题文献、归纳痛点、处理创新点，并生成 Introduction。</p>
        </div>
      </div>
    </div>
  );
}

export function Workbench() {
  const [currentUser, setCurrentUser] = useState("");
  const [configVersion, setConfigVersion] = useState("");
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [searches, setSearches] = useState<SearchMeta[]>([]);
  const [introductions, setIntroductions] = useState<IntroductionMeta[]>([]);
  const [view, setView] = useState<MainView>({ type: "workspace" });
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);
  const [selectedIntroId, setSelectedIntroId] = useState<string | null>(null);
  const [appState, setAppState] = useState<AppState>("IDLE");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [searchTopic, setSearchTopic] = useState("");
  const [searchRequirements, setSearchRequirements] = useState("");
  const [preprintRule, setPreprintRule] = useState(DEFAULT_PREPRINT_RULE);
  const [activeSearchJobId, setActiveSearchJobId] = useState("");
  const [currentSearchJobId, setCurrentSearchJobId] = useState("");
  const [finalResult, setFinalResult] = useState("");
  const [uiLogs, setUiLogs] = useState<Array<{ title: string; content: string }>>([]);
  const [feedbackStartAt, setFeedbackStartAt] = useState<number | null>(null);
  const [hasProvidedFeedback, setHasProvidedFeedback] = useState(false);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [readyReports, setReadyReports] = useState<ReadyReport[]>([]);
  const [selectedReportRecord, setSelectedReportRecord] = useState<AnalysisResult | null>(null);
  const [selectedReportMeta, setSelectedReportMeta] = useState<ReportMeta | null>(null);
  const [selectedReportLogs, setSelectedReportLogs] = useState<AgentLog[]>([]);
  const [selectedSearchRecord, setSelectedSearchRecord] = useState<SearchRecord | null>(null);
  const [newFeedback, setNewFeedback] = useState("");
  const [activeSearchContext, setActiveSearchContext] = useState<SearchContext | null>(null);
  const [introSourceMode, setIntroSourceMode] = useState<IntroSourceMode>("pdf");
  const [introInnovationMode, setIntroInnovationMode] = useState<IntroInnovationMode>("existing");
  const [introSeedPdf, setIntroSeedPdf] = useState<File | null>(null);
  const [introManualProblemText, setIntroManualProblemText] = useState("");
  const [introTaskGoal, setIntroTaskGoal] = useState("");
  const [introTaskGranularity, setIntroTaskGranularity] = useState("");
  const [introResearchObject, setIntroResearchObject] = useState("");
  const [introInputOutput, setIntroInputOutput] = useState("");
  const [introInnovationText, setIntroInnovationText] = useState("");
  const [introTargetLanguage, setIntroTargetLanguage] = useState("中文");
  const [introTargetWords, setIntroTargetWords] = useState("1000");
  const [activeIntroJobId, setActiveIntroJobId] = useState("");
  const [currentIntroJobId, setCurrentIntroJobId] = useState("");
  const [selectedIntroRecord, setSelectedIntroRecord] = useState<IntroductionRecord | null>(null);
  const [introReferenceFiles, setIntroReferenceFiles] = useState<File[]>([]);
  const [selectedInnovationIndexes, setSelectedInnovationIndexes] = useState<number[]>([]);
  const [analysisSubmitting, setAnalysisSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const introSeedInputRef = useRef<HTMLInputElement | null>(null);
  const introReferenceInputRef = useRef<HTMLInputElement | null>(null);

  const usernameKey = useMemo(() => canonicalUsername(currentUser), [currentUser]);

  const refreshHistories = useCallback(async (username = currentUser) => {
    if (!username) return;
    const [reportIndex, searchIndex, introductionIndex] = await Promise.all([
      loadUserReportIndex(username),
      loadUserSearchIndex(username),
      loadUserIntroductionIndex(username),
    ]);
    setReports(reportIndex || []);
    setSearches(searchIndex || []);
    setIntroductions(introductionIndex || []);
  }, [currentUser]);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("paperseacrh_current_user") : "";
    if (stored) setCurrentUser(stored);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    async function init() {
      try {
        await ensureAppStorage();
        const cfg = await getPublicBackendConfig();
        if (!cancelled) setConfigVersion(cfg.analysis_cache_version || "");
        await refreshHistories(currentUser);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    init();
    return () => { cancelled = true; };
  }, [currentUser, refreshHistories]);

  useEffect(() => {
    if (!activeSearchJobId || !currentUser || appState !== "SEARCH_RUNNING") return;
    let cancelled = false;
    async function poll() {
      try {
        const meta = await getUserSearchJobState(currentUser, activeSearchJobId);
        if (cancelled || !meta) return;
        const status = (meta.status || "").toLowerCase();
        if (status === "finished") {
          const record = await loadUserSearchRecord(currentUser, activeSearchJobId);
          if (!cancelled && record) {
            setFinalResult(record.result_markdown || "后端未返回有效检索结果。");
            setUiLogs(buildSearchUiLogs(record.agent_logs || []));
            setAppState("WAITING_FEEDBACK");
            setFeedbackStartAt(Date.now());
            setCurrentSearchJobId(activeSearchJobId);
            setActiveSearchJobId("");
            await refreshHistories(currentUser);
          }
        } else if (status === "failed") {
          setError(meta.progress_text || "论文检索任务失败。");
          setAppState("IDLE");
          setActiveSearchJobId("");
          await refreshHistories(currentUser);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    poll();
    const timer = window.setInterval(poll, JOB_STATUS_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSearchJobId, appState, currentUser, refreshHistories]);

  useEffect(() => {
    if (!activeIntroJobId || !currentUser) return;
    let cancelled = false;

    async function poll() {
      try {
        const meta = await getUserIntroductionJobState(currentUser, activeIntroJobId);
        if (cancelled || !meta) return;
        const status = (meta.status || "").toLowerCase();

        if (["waiting_reference_upload", "waiting_innovation_selection", "finished", "failed"].includes(status)) {
          const record = await loadUserIntroductionRecord(currentUser, activeIntroJobId);
          if (!cancelled && record) {
            setSelectedIntroRecord(record);
            setSelectedIntroId(activeIntroJobId);
            setCurrentIntroJobId(activeIntroJobId);
            setView({ type: "introduction", introJobId: activeIntroJobId });
            setActiveIntroJobId("");
            await refreshHistories(currentUser);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    poll();
    const timer = window.setInterval(poll, JOB_STATUS_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeIntroJobId, currentUser, refreshHistories]);

  function login(username: string) {
    setCurrentUser(username);
    localStorage.setItem("paperseacrh_current_user", username);
    setView({ type: "workspace" });
  }

  function logout() {
    localStorage.removeItem("paperseacrh_current_user");
    setCurrentUser("");
    setConfigVersion("");
    setReports([]);
    setSearches([]);
    setIntroductions([]);
    setView({ type: "workspace" });
    setSelectedReportId(null);
    setSelectedSearchId(null);
    setSelectedIntroId(null);
    setAppState("IDLE");
    setMessage("");
    setError("");
    setSearchTopic("");
    setSearchRequirements("");
    setPreprintRule(DEFAULT_PREPRINT_RULE);
    setActiveSearchJobId("");
    setCurrentSearchJobId("");
    setFinalResult("");
    setUiLogs([]);
    setFeedbackStartAt(null);
    setHasProvidedFeedback(false);
    setBatchRows([]);
    setReadyReports([]);
    setSelectedReportRecord(null);
    setSelectedReportMeta(null);
    setSelectedReportLogs([]);
    setSelectedSearchRecord(null);
    setNewFeedback("");
    setActiveSearchContext(null);
    setIntroSourceMode("pdf");
    setIntroInnovationMode("existing");
    setIntroSeedPdf(null);
    setIntroManualProblemText("");
    setIntroTaskGoal("");
    setIntroTaskGranularity("");
    setIntroResearchObject("");
    setIntroInputOutput("");
    setIntroInnovationText("");
    setIntroTargetLanguage("中文");
    setIntroTargetWords("1000");
    setActiveIntroJobId("");
    setCurrentIntroJobId("");
    setSelectedIntroRecord(null);
    setIntroReferenceFiles([]);
    setSelectedInnovationIndexes([]);
    clearSelectedPdfFiles();
  }

  function resetWorkspace() {
    setSelectedReportId(null);
    setSelectedSearchId(null);
    setSelectedIntroId(null);
    setSelectedReportRecord(null);
    setSelectedReportMeta(null);
    setSelectedReportLogs([]);
    setSelectedSearchRecord(null);
    setSelectedIntroRecord(null);
    setView({ type: "workspace" });
  }

  function clearSelectedPdfFiles() {
    setPdfFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function clearIntroSeedPdf() {
    setIntroSeedPdf(null);
    if (introSeedInputRef.current) {
      introSeedInputRef.current.value = "";
    }
  }

  function clearIntroReferenceFiles() {
    setIntroReferenceFiles([]);
    if (introReferenceInputRef.current) {
      introReferenceInputRef.current.value = "";
    }
  }

  function addIntroReferenceFiles(files: File[]) {
    const pdfs = files.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) {
      if (introReferenceInputRef.current) introReferenceInputRef.current.value = "";
      return;
    }

    setIntroReferenceFiles((previous) => {
      const seen = new Set(previous.map(fileIdentity));
      const merged = [...previous];

      for (const file of pdfs) {
        const key = fileIdentity(file);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(file);
        }
      }

      return merged.slice(0, 6);
    });

    if (introReferenceInputRef.current) {
      introReferenceInputRef.current.value = "";
    }
  }

  function removeIntroReferenceFile(index: number) {
    setIntroReferenceFiles((previous) => previous.filter((_, currentIndex) => currentIndex !== index));
  }

  function addPdfFiles(files: File[]) {
    const pdfs = files.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setPdfFiles((previous) => {
      const seen = new Set(previous.map(fileIdentity));
      const merged = [...previous];

      for (const file of pdfs) {
        const key = fileIdentity(file);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(file);
        }
      }

      return merged;
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removePdfFile(index: number) {
    setPdfFiles((previous) => previous.filter((_, currentIndex) => currentIndex !== index));
  }

  function resetToInitialView() {
    setError("");
    setMessage("");
    setFinalResult("");
    setUiLogs([]);
    setActiveSearchJobId("");
    setCurrentSearchJobId("");
    setFeedbackStartAt(null);
    setHasProvidedFeedback(false);
    setNewFeedback("");
    setActiveSearchContext(null);
    setBatchRows([]);
    setReadyReports([]);
    setActiveIntroJobId("");
    setCurrentIntroJobId("");
    setSelectedIntroRecord(null);
    setSelectedIntroId(null);
    setIntroReferenceFiles([]);
    setSelectedInnovationIndexes([]);
    clearSelectedPdfFiles();
    if (introReferenceInputRef.current) {
      introReferenceInputRef.current.value = "";
    }
    resetWorkspace();
    setAppState("IDLE");
    void refreshHistories(currentUser);
  }

  function openLatestActivity() {
    setError("");
    setMessage("");

    if (batchRows.length) {
      setView({ type: "analysis-batch", files: [] });
      return;
    }

    if (activeSearchJobId) {
      setView({ type: "workspace" });
      setAppState("SEARCH_RUNNING");
      return;
    }

    const latestReport = reports[0];
    const latestSearch = searches[0];
    const latestIntro = introductions[0];
    const latestReportTime = reportActivityTime(latestReport);
    const latestSearchTime = searchActivityTime(latestSearch);
    const latestIntroTime = parseHistoryTime(latestIntro?.updated_at || latestIntro?.created_at);

    if (latestSearch && ["queued", "processing"].includes((latestSearch.status || "").toLowerCase())) {
      setSelectedSearchId(latestSearch.search_job_id);
      setSelectedReportId(null);
      setSelectedIntroId(null);
      setCurrentSearchJobId(latestSearch.search_job_id);
      setActiveSearchJobId(latestSearch.search_job_id);
      setView({ type: "workspace" });
      setAppState("SEARCH_RUNNING");
      return;
    }

    if (latestIntro && ["queued", "processing"].includes((latestIntro.status || "").toLowerCase())) {
      setSelectedIntroId(latestIntro.id);
      setSelectedReportId(null);
      setSelectedSearchId(null);
      setCurrentIntroJobId(latestIntro.id);
      setActiveIntroJobId(latestIntro.id);
      setView({ type: "introduction", introJobId: latestIntro.id });
      return;
    }

    if (latestIntro && latestIntroTime >= latestSearchTime && latestIntroTime >= latestReportTime) {
      void loadIntroductionView(latestIntro.id);
      return;
    }

    if (latestSearch && latestSearchTime > latestReportTime) {
      void loadSearchView(latestSearch.search_job_id);
      return;
    }

    if (latestReport) {
      void loadReportView(latestReport.report_id);
      return;
    }

    resetWorkspace();
    setAppState("IDLE");
  }

  async function startPaperSearch() {
    setError("");
    setMessage("");
    if (!searchTopic.trim()) {
      setError("请填写研究主题。");
      return;
    }
    try {
      const searchContext: SearchContext = {
        topic: searchTopic.trim(),
        requirements: searchRequirements,
        preprintRule,
      };
      resetWorkspace();
      setFinalResult("");
      setUiLogs([]);
      setHasProvidedFeedback(false);
      setFeedbackStartAt(null);
      setActiveSearchContext(searchContext);
      setMessage("正在创建后台检索任务，并交由统一 Director 调度……");
      const job = await createPaperSearchJob({
        username: currentUser,
        userTopic: searchContext.topic,
        userRequirements: searchContext.requirements,
        preprintRule: searchContext.preprintRule,
      });
      await submitPaperSearchJob(job.search_job_id);
      await updatePaperSearchJobStatus(job.search_job_id, "processing", "后台检索任务已提交，等待 Agent 完成候选文献筛选");
      setActiveSearchJobId(job.search_job_id);
      setCurrentSearchJobId(job.search_job_id);
      setAppState("SEARCH_RUNNING");
      setMessage("后台文献检索任务已提交。页面会自动轮询状态。关闭页面后仍可稍后重新登录查看结果。");
      setSearchTopic("");
      setSearchRequirements("");
      setPreprintRule(DEFAULT_PREPRINT_RULE);
      await refreshHistories(currentUser);
    } catch (err) {
      setAppState("IDLE");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startIntroductionJob() {
    setError("");
    setMessage("");

    if (introSourceMode === "pdf" && !introSeedPdf) {
      setError("请选择一篇种子论文 PDF，或切换为手动填写研究问题。");
      return;
    }

    if (introSourceMode === "manual" && !introManualProblemText.trim() && !introTaskGoal.trim() && !introTaskGranularity.trim()) {
      setError("没有种子论文 PDF 时，请至少填写研究问题、任务目标或任务粒度。");
      return;
    }

    if (introInnovationMode === "existing" && !introInnovationText.trim()) {
      setError("选择已有创新点时，请填写你的创新点内容。");
      return;
    }

    try {
      resetWorkspace();
      setMessage("正在提交 Introduction 写作任务，并交由统一 Director 调度……");

      const result = await submitIntroductionJob(
        {
          username: currentUser,
          title: introSourceMode === "pdf"
            ? `Introduction 写作：${introSeedPdf?.name || "种子论文"}`
            : `Introduction 写作：${shorten(introManualProblemText || introTaskGoal || "手动研究问题", 30)}`,
          hasSeedPdf: introSourceMode === "pdf",
          manualProblemText: introManualProblemText,
          taskGoal: introTaskGoal,
          taskGranularity: introTaskGranularity,
          researchObject: introResearchObject,
          inputOutput: introInputOutput,
          hasUserInnovation: introInnovationMode === "existing",
          userInnovationText: introInnovationText,
          targetLanguage: introTargetLanguage,
          targetWords: introTargetWords,
        },
        introSourceMode === "pdf" ? introSeedPdf : null,
      );

      const introJobId = String(result.job_id || result.id || "");
      if (!introJobId) {
        throw new Error("后端未返回 Introduction 任务 ID。");
      }

      setActiveIntroJobId(introJobId);
      setCurrentIntroJobId(introJobId);
      setSelectedIntroId(introJobId);
      setView({ type: "introduction", introJobId });
      setMessage("Introduction 写作任务已提交。页面会自动轮询状态；搜索完成后会提示你上传 3-6 篇参考论文 PDF。");
      clearIntroSeedPdf();
      clearIntroReferenceFiles();
      await refreshHistories(currentUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadIntroductionView(introJobId: string) {
    setError("");
    setSelectedIntroId(introJobId);
    setSelectedReportId(null);
    setSelectedSearchId(null);
    setView({ type: "introduction", introJobId });
    setSelectedIntroRecord(null);
    setSelectedInnovationIndexes([]);
    try {
      const record = await loadUserIntroductionRecord(currentUser, introJobId);
      if (!record) {
        setError("未找到该 Introduction 写作任务，可能已被删除。");
        return;
      }
      setSelectedIntroRecord(record);
      const status = (record.status || "").toLowerCase();
      if (["queued", "processing"].includes(status)) {
        setActiveIntroJobId(introJobId);
        setCurrentIntroJobId(introJobId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitIntroReferencePapers() {
    const introJobId = selectedIntroRecord?.id || currentIntroJobId || selectedIntroId || "";
    if (!introJobId) {
      setError("缺少 Introduction 任务 ID，无法上传参考论文。");
      return;
    }
    if (introReferenceFiles.length < 1) {
      setError("请先选择 3-6 篇参考论文 PDF。");
      return;
    }
    if (introReferenceFiles.length > 6) {
      setError("参考论文 PDF 最多上传 6 篇。");
      return;
    }

    try {
      setError("");
      setMessage("正在上传参考论文 PDF，并继续 Introduction 写作流程……");
      await uploadIntroductionReferences(introJobId, introReferenceFiles);
      clearIntroReferenceFiles();
      setSelectedIntroRecord((previous) =>
        previous && previous.id === introJobId
          ? {
              ...previous,
              status: "processing",
              progress_text: "参考论文 PDF 已上传，正在继续 Introduction 写作流程……",
            }
          : previous,
      );
      setActiveIntroJobId(introJobId);
      setCurrentIntroJobId(introJobId);
      setMessage("参考论文 PDF 已上传，正在继续 Introduction 写作流程……");
      await refreshHistories(currentUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitSelectedInnovations() {
    const introJobId = selectedIntroRecord?.id || currentIntroJobId || selectedIntroId || "";
    const candidates = selectedIntroRecord?.innovation_candidates || [];
    const selected = selectedInnovationIndexes
      .map((index) => candidates[index])
      .filter(Boolean);

    if (!introJobId) {
      setError("缺少 Introduction 任务 ID，无法提交创新点选择。");
      return;
    }
    if (!selected.length) {
      setError("请至少选择一个创新点。");
      return;
    }

    try {
      setError("");
      setMessage("正在提交已选择的创新点，并继续生成 Introduction……");
      await selectIntroductionInnovations(introJobId, selected);
      setSelectedInnovationIndexes([]);
      setActiveIntroJobId(introJobId);
      setCurrentIntroJobId(introJobId);
      await refreshHistories(currentUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadReportView(reportId: string) {
    setError("");
    setSelectedReportId(reportId);
    setSelectedSearchId(null);
    setSelectedIntroId(null);
    setView({ type: "report", reportId });
    setSelectedReportRecord(null);
    setSelectedReportMeta(null);
    setSelectedReportLogs([]);
    try {
      const meta = await getUserJobState(currentUser, reportId);
      setSelectedReportMeta(meta);
      const status = (meta?.status || "").toLowerCase();
      if (status === "finished") {
        const [payload, logs] = await Promise.all([
          loadUserReportRecord(currentUser, reportId),
          loadAgentLogs(currentUser, reportId),
        ]);
        if (payload) {
          setSelectedReportMeta(payload.meta);
          setSelectedReportRecord(payload.analysis_result);
        }
        setSelectedReportLogs(logs || []);
      } else {
        const logs = await loadAgentLogs(currentUser, reportId);
        setSelectedReportLogs(logs || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadSearchView(searchJobId: string) {
    setError("");
    setSelectedSearchId(searchJobId);
    setSelectedReportId(null);
    setSelectedIntroId(null);
    setView({ type: "search", searchJobId });
    setSelectedSearchRecord(null);
    try {
      const record = await loadUserSearchRecord(currentUser, searchJobId);
      if (!record) {
        setError("未找到该文献检索档案，可能已被删除。");
        return;
      }
      const status = (record.meta.status || "").toLowerCase();
      if (status === "finished" && !record.meta.is_final) {
        setFinalResult(record.result_markdown || "该检索任务暂无结果。");
        setUiLogs(buildSearchUiLogs(record.agent_logs || []));
        setCurrentSearchJobId(searchJobId);
        const context: SearchContext = {
          topic: record.meta.topic || "",
          requirements: record.meta.requirements || "",
          preprintRule: record.meta.preprint_rule || DEFAULT_PREPRINT_RULE,
        };
        setActiveSearchContext(context);
        setSearchTopic(context.topic);
        setSearchRequirements(context.requirements);
        setPreprintRule(context.preprintRule);
        setFeedbackStartAt(Date.now());
        setAppState("WAITING_FEEDBACK");
        setView({ type: "workspace" });
        return;
      }
      setSelectedSearchRecord(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startAnalysis(files: File[]) {
    const submittedFiles = [...files];
    setError("");
    setMessage("");
    setBatchRows([]);
    setReadyReports([]);

    if (!submittedFiles.length || analysisSubmitting) return;

    setAnalysisSubmitting(true);
    try {
      let analysisCacheVersion = configVersion;

      if (!analysisCacheVersion) {
        const cfg = await getPublicBackendConfig();
        analysisCacheVersion = cfg.analysis_cache_version || "";
        setConfigVersion(analysisCacheVersion);
      }

      if (!analysisCacheVersion) {
        setError("后端未返回 analysis_cache_version，无法生成 PDF 缓存键。");
        return;
      }

      clearSelectedPdfFiles();
      setView({ type: "analysis-batch", files: submittedFiles });

      const rerunStamp = Date.now();

      const initialRows: BatchRow[] = await Promise.all(
        submittedFiles.map(async (file, index) => {
          const baseCacheKey = await getPdfCacheKey(file, analysisCacheVersion);
          const cacheKey = `${baseCacheKey}:rerun:${rerunStamp}:${index + 1}`;

          return {
            index: index + 1,
            source_name: file.name || `paper_${index + 1}.pdf`,
            cache_key: cacheKey,
            status: "processing",
            progress_text: "任务正在初始化中，请稍候。",
          };
        })
      );

      setBatchRows(initialRows);

      const updateBatchRow = (cacheKey: string, patch: Partial<BatchRow>) => {
        setBatchRows((previous) =>
          previous.map((row) =>
            row.cache_key === cacheKey
              ? { ...row, ...patch }
              : row
          )
        );
      };

      const ready: ReadyReport[] = [];

      async function submitOneAnalysisFile(file: File, index: number) {
        const row = initialRows[index];

        try {
          // 历史报告查重已关闭：不再读取 cached report，也不再复用同 cache_key 的旧任务。
          // 每次上传都生成一个带 rerun 后缀的新 cache_key，让后端创建全新的解析任务。
          const result = await createOrReuseAnalysisJob(currentUser, row.source_name, row.cache_key);

          updateBatchRow(row.cache_key, {
            report_id: result.job.report_id,
            status: result.job.status || "queued",
            progress_text: result.job.progress_text || "任务已创建。",
          });

          if (result.should_submit) {
            await submitAnalysisJob(result.job.report_id, row.source_name, row.cache_key, file);
            await updateAnalysisJobStatus(result.job.report_id, "processing", "后台任务已启动，等待离线解析完成");

            updateBatchRow(row.cache_key, {
              report_id: result.job.report_id,
              status: "processing",
              progress_text: "后台任务已创建，正在等待离线解析。",
            });
          }
        } catch (err) {
          updateBatchRow(row.cache_key, {
            status: "failed",
            progress_text: err instanceof Error ? err.message : String(err),
          });
        }
      }

      let nextFileIndex = 0;
      const workerCount = Math.min(MAX_ANALYSIS_SUBMIT_CONCURRENCY, submittedFiles.length);

      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (nextFileIndex < submittedFiles.length) {
            const currentIndex = nextFileIndex;
            nextFileIndex += 1;
            await submitOneAnalysisFile(submittedFiles[currentIndex], currentIndex);
          }
        })
      );

      setReadyReports(ready);
      await refreshHistories(currentUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalysisSubmitting(false);
    }
  }

  async function confirmSearch() {
    if (!currentSearchJobId) return;
    try {
      await finalizePaperSearchJob(currentSearchJobId);
      setAppState("COMPLETED");
      setFeedbackStartAt(null);
      await refreshHistories(currentUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitFeedbackSearch() {
    if (!newFeedback.trim()) return;
    try {
      const previousSearchJobId = currentSearchJobId;
      const context = activeSearchContext || {
        topic: searchTopic.trim(),
        requirements: searchRequirements,
        preprintRule,
      };

      if (!context.topic.trim()) {
        setError("缺少原始研究主题，无法提交修正检索。请重新发起一次文献检索。");
        return;
      }

      const job = await createPaperSearchJob({
        username: currentUser,
        userTopic: context.topic,
        userRequirements: context.requirements,
        preprintRule: context.preprintRule,
        feedback: newFeedback.trim(),
        previousResult: finalResult,
      });
      await markPaperSearchJobSuperseded(previousSearchJobId, job.search_job_id);
      await submitPaperSearchJob(job.search_job_id);
      await updatePaperSearchJobStatus(job.search_job_id, "processing", "修正检索任务已提交，等待 Agent 完成新一轮筛选");
      setActiveSearchJobId(job.search_job_id);
      setCurrentSearchJobId(job.search_job_id);
      setActiveSearchContext(context);
      setHasProvidedFeedback(true);
      setFeedbackStartAt(null);
      setNewFeedback("");
      setAppState("SEARCH_RUNNING");
      await refreshHistories(currentUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!currentUser) return <LoginCard onLogin={login} />;

  const currentSearchState = searches.find((item) => item.search_job_id === activeSearchJobId);
  const currentIntroState = introductions.find((item) => item.id === activeIntroJobId);
  const selectedIntroStatus = (selectedIntroRecord?.status || "").toLowerCase();
  const shouldShowIntroReferenceUpload = selectedIntroStatus === "waiting_reference_upload";
  const shouldShowIntroInnovationSelection = selectedIntroStatus === "waiting_innovation_selection";
  const pendingRows = batchRows.filter((row) => ["queued", "processing"].includes((row.status || "").toLowerCase()));
  const selectedPendingReport = selectedReportMeta && ["queued", "processing"].includes((selectedReportMeta.status || "").toLowerCase());

  return (
    <div className="app-shell" key={usernameKey}>
      <Sidebar
        username={currentUser}
        reports={reports}
        searches={searches}
        introductions={introductions}
        selectedReportId={selectedReportId}
        selectedSearchId={selectedSearchId}
        selectedIntroId={selectedIntroId}
        onRefresh={resetToInitialView}
        onLogout={logout}
        onSelectWorkspace={resetToInitialView}
        onSelectReport={loadReportView}
        onSelectSearch={loadSearchView}
        onSelectIntroduction={loadIntroductionView}
      />
      <main className="main stack">
        {error ? <div className="notice error">{error}</div> : null}
        {message ? <div className="notice">{message}</div> : null}

        <section className="grid-2 task-grid">
          <div className="card stack task-card">
            <h2>文献检索</h2>
            <div className="stack-sm">
              <label className="small">研究主题</label>
              <input className="input" value={searchTopic} onChange={(event) => setSearchTopic(event.target.value)} placeholder="输入研究主题" />
            </div>
            <div className="stack-sm">
              <label className="small">筛选约束与偏好</label>
              <textarea className="textarea" value={searchRequirements} onChange={(event) => setSearchRequirements(event.target.value)} placeholder="例如：限定任务类型、方法路线、应用场景、发表渠道或排除条件。" />
            </div>
            <select className="select" value={preprintRule} onChange={(event) => setPreprintRule(event.target.value)}>
              <option>{DEFAULT_PREPRINT_RULE}</option>
              <option>接受预印本 (如 arXiv)</option>
            </select>
            <button className="button full" onClick={startPaperSearch} disabled={!searchTopic.trim() || appState === "SEARCH_RUNNING"}>启动文献检索任务</button>
          </div>

          <div className="card stack task-card">
            <h2>论文精读入口</h2>
            <p className="muted">上传一篇或多篇 PDF，后端会分别生成结构化精读报告并保存到当前账号档案。</p>
            <input
              ref={fileInputRef}
              className="file-input"
              type="file"
              accept="application/pdf"
              multiple
              onChange={(event) => addPdfFiles(Array.from(event.target.files || []))}
            />
            {pdfFiles.length ? (
              <div className="selected-file-list">
                {pdfFiles.map((file, index) => (
                  <div key={fileIdentity(file)} className="selected-file-item">
                    <span className="selected-file-name">{index + 1}. {file.name}</span>
                    <button className="button secondary tiny" type="button" onClick={() => removePdfFile(index)}>删除</button>
                  </div>
                ))}
                <button className="button secondary" type="button" onClick={clearSelectedPdfFiles}>清空已选文件</button>
              </div>
            ) : (
              <p className="small">尚未选择 PDF。可以多次点击“选择文件”追加论文。</p>
            )}
            <button className="button full" disabled={!pdfFiles.length || analysisSubmitting} onClick={() => startAnalysis(pdfFiles)}>{analysisSubmitting ? "正在提交..." : "启动深度解析"}</button>
          </div>

          <div className="card stack task-card">
            <h2>Introduction 写作工作台</h2>
            <p className="muted">上传种子论文或手动填写研究问题，系统会检索同问题文献、等待你上传参考论文，并生成 Introduction。</p>

            <div className="tabs">
              <button className={`tab ${introSourceMode === "pdf" ? "active" : ""}`} type="button" onClick={() => setIntroSourceMode("pdf")}>上传种子论文 PDF</button>
              <button className={`tab ${introSourceMode === "manual" ? "active" : ""}`} type="button" onClick={() => setIntroSourceMode("manual")}>手动填写研究问题</button>
            </div>

            {introSourceMode === "pdf" ? (
              <div className="stack-sm">
                <label className="small">种子论文 PDF</label>
                <input
                  ref={introSeedInputRef}
                  className="file-input"
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => {
                    const file = (event.target.files?.[0] || null) as File | null;
                    if (file && !(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
                      setError("种子论文只能上传 PDF 文件。");
                      clearIntroSeedPdf();
                      return;
                    }
                    setIntroSeedPdf(file);
                  }}
                />
                {introSeedPdf ? (
                  <div className="selected-file-item">
                    <span className="selected-file-name">{introSeedPdf.name}</span>
                    <button className="button secondary tiny" type="button" onClick={clearIntroSeedPdf}>删除</button>
                  </div>
                ) : <p className="small">系统会重点读取 Abstract / Introduction / Discussion / Conclusion / Limitations。</p>}
              </div>
            ) : (
              <div className="stack-sm">
                <label className="small">研究问题</label>
                <textarea className="textarea" value={introManualProblemText} onChange={(event) => setIntroManualProblemText(event.target.value)} placeholder="例如：预测蛋白质序列中的核苷酸结合残基。" />
                <label className="small">任务目标</label>
                <input className="input" value={introTaskGoal} onChange={(event) => setIntroTaskGoal(event.target.value)} placeholder="例如：识别每个残基是否为结合位点" />
                <label className="small">任务粒度</label>
                <input className="input" value={introTaskGranularity} onChange={(event) => setIntroTaskGranularity(event.target.value)} placeholder="例如：残基级、序列级、端到端控制层面" />
                <label className="small">研究对象 / 应用场景</label>
                <input className="input" value={introResearchObject} onChange={(event) => setIntroResearchObject(event.target.value)} placeholder="例如：蛋白质序列中的结合残基" />
                <label className="small">输入与输出</label>
                <input className="input" value={introInputOutput} onChange={(event) => setIntroInputOutput(event.target.value)} placeholder="例如：输入蛋白质序列，输出残基级二分类结果" />
              </div>
            )}

            <div className="tabs">
              <button className={`tab ${introInnovationMode === "existing" ? "active" : ""}`} type="button" onClick={() => setIntroInnovationMode("existing")}>我已有创新点</button>
              <button className={`tab ${introInnovationMode === "generate" ? "active" : ""}`} type="button" onClick={() => setIntroInnovationMode("generate")}>系统生成候选创新点</button>
            </div>

            {introInnovationMode === "existing" ? (
              <div className="stack-sm">
                <label className="small">已有创新点</label>
                <textarea className="textarea" value={introInnovationText} onChange={(event) => setIntroInnovationText(event.target.value)} placeholder="请列出你的创新点、方法想法或改进方向。" />
              </div>
            ) : (
              <p className="small">系统会在参考论文分析后生成多个候选创新点，并让你选择后继续写作。</p>
            )}

            <div className="grid-2">
              <div className="stack-sm">
                <label className="small">目标语言</label>
                <select className="select" value={introTargetLanguage} onChange={(event) => setIntroTargetLanguage(event.target.value)}>
                  <option>中文</option>
                  <option>英文</option>
                </select>
              </div>
              <div className="stack-sm">
                <label className="small">目标字数</label>
                <input className="input" value={introTargetWords} onChange={(event) => setIntroTargetWords(event.target.value)} placeholder="例如：1000" />
              </div>
            </div>

            <button className="button full" onClick={startIntroductionJob}>启动 Introduction 写作任务</button>
          </div>
        </section>

        {appState === "SEARCH_RUNNING" ? (
          <div className="card stack">
            <h2>文献检索运行中</h2>
            <div className="notice">{currentSearchState?.progress_text || "后台文献检索任务正在运行。页面会自动轮询状态。"}</div>
            <p className="small">任务已由后台接管。关闭页面后仍可稍后重新登录查看结果。</p>
          </div>
        ) : null}

        {activeIntroJobId ? (
          <div className="card stack">
            <h2>Introduction 写作运行中</h2>
            <div className="notice">{currentIntroState?.progress_text || "后台 Introduction 写作任务正在运行。页面会自动轮询状态。"}</div>
            <p className="small">任务已由后台接管。关闭页面后仍可稍后重新登录查看结果。搜索完成后，系统会停在“等待上传参考论文”阶段。</p>
          </div>
        ) : null}

        {appState !== "IDLE" && uiLogs.length ? (
          <div className="card stack">
            <h2>检索 Agent 执行轨迹</h2>
            {uiLogs.map((log, index) => (
              <details key={index} className="card-soft">
                <summary>{log.title}</summary>
                <MarkdownReport markdown={log.content} normalize={false} />
              </details>
            ))}
          </div>
        ) : null}

        {appState === "WAITING_FEEDBACK" ? (
          <div className="card stack">
            <h2>候选文献组合</h2>
            {feedbackStartAt ? <p className="small">若无进一步操作，后端将在约 {Math.max(0, Math.floor((1800000 - (Date.now() - feedbackStartAt)) / 60000))} 分钟后自动确认当前结果并归档。</p> : null}
            <p>请审阅当前候选文献组合。确认后，本轮结果才会写入最终去重库；若继续修正，本轮结果不会作为最终推荐保存。</p>
            <div className="card-soft"><MarkdownReport markdown={finalResult} normalize={false} /></div>
            <div className="grid-2">
              <button className="button" onClick={confirmSearch}>确认当前结果并归档</button>
              <div className="stack-sm">
                <textarea className="textarea" value={newFeedback} onChange={(event) => setNewFeedback(event.target.value)} placeholder="请说明需要修正的方向或需要排除的结果" />
                <button className="button secondary" disabled={!newFeedback.trim()} onClick={submitFeedbackSearch}>提交修正要求并重新检索</button>
              </div>
            </div>
          </div>
        ) : null}

        {appState === "COMPLETED" ? (
          <div className="card stack">
            <div className="notice success">文献检索任务已确认归档。</div>
            {hasProvidedFeedback === false ? null : <p className="small">本次结果包含修正后的检索条件。</p>}
            <h2>最终确认的六篇候选文献</h2>
            <div className="card-soft"><MarkdownReport markdown={finalResult} normalize={false} /></div>
          </div>
        ) : null}

        {view.type === "workspace" && appState === "IDLE" && !batchRows.length ? <WorkspaceIntro /> : null}

        {view.type === "search" && selectedSearchRecord ? (
          <div className="card stack">
            <h2>文献检索档案：{selectedSearchRecord.meta.topic || "论文检索"}</h2>
            {selectedSearchRecord.meta.requirements ? <div className="card-soft"><strong>筛选约束：</strong><MarkdownReport markdown={selectedSearchRecord.meta.requirements} normalize={false} /></div> : null}
            {(selectedSearchRecord.agent_logs || []).length ? (
              <div className="stack">
                <h3>检索 Agent 执行轨迹</h3>
                {buildSearchUiLogs(selectedSearchRecord.agent_logs).map((log, index) => (
                  <details key={index} className="card-soft">
                    <summary>{log.title}</summary>
                    <MarkdownReport markdown={log.content} normalize={false} />
                  </details>
                ))}
              </div>
            ) : null}
            <h3>六篇候选文献</h3>
            <div className="card-soft"><MarkdownReport markdown={selectedSearchRecord.result_markdown || "该历史检索暂无结果。"} normalize={false} /></div>
          </div>
        ) : null}

        {view.type === "introduction" ? (
          <div className="card stack intro-result-view">
            <h2>Introduction 写作任务</h2>
            {selectedIntroRecord ? (
              <>
                <div className={`notice ${(selectedIntroRecord.status || "").toLowerCase() === "failed" ? "error" : "success"}`}>
                  当前状态：{introductionStatusText(selectedIntroRecord.status)}。{selectedIntroRecord.progress_text || ""}
                </div>

                {selectedIntroRecord.problem_card ? (
                  <details className="card-soft">
                    <summary>研究问题卡</summary>
                    <MarkdownReport markdown={renderIntroValueAsMarkdown(selectedIntroRecord.problem_card)} normalize={false} />
                  </details>
                ) : null}

                {selectedIntroRecord.search_query_pack ? (
                  <details className="card-soft">
                    <summary>搜索关键词与筛选要求</summary>
                    <MarkdownReport markdown={renderIntroValueAsMarkdown(selectedIntroRecord.search_query_pack)} normalize={false} />
                  </details>
                ) : null}

                {selectedIntroRecord.search_results_markdown ? (
                  <details className="card-soft" open={shouldShowIntroReferenceUpload}>
                    <summary>搜索结果</summary>
                    <div className="stack" style={{ marginTop: 12 }}>
                      {shouldShowIntroReferenceUpload ? (
                        <p className="small">请根据系统推荐结果自行下载 3-6 篇相关 PDF，并在下方上传。</p>
                      ) : null}
                      <MarkdownReport markdown={selectedIntroRecord.search_results_markdown} normalize={false} />
                    </div>
                  </details>
                ) : null}

                {shouldShowIntroReferenceUpload ? (
                  <div className="card-soft stack">
                    <h3>上传参考论文 PDF</h3>
                    <p className="small">建议上传 3-6 篇与搜索结果高度相关的参考论文 PDF。上传后，后端会继续轻量精读这些论文并归纳领域痛点。</p>
                    <input
                      ref={introReferenceInputRef}
                      className="file-input"
                      type="file"
                      accept="application/pdf"
                      multiple
                      onChange={(event) => addIntroReferenceFiles(Array.from(event.target.files || []))}
                    />
                    {introReferenceFiles.length ? (
                      <div className="selected-file-list">
                        {introReferenceFiles.map((file, index) => (
                          <div key={fileIdentity(file)} className="selected-file-item">
                            <span className="selected-file-name">{index + 1}. {file.name}</span>
                            <button className="button secondary tiny" type="button" onClick={() => removeIntroReferenceFile(index)}>删除</button>
                          </div>
                        ))}
                        <button className="button secondary" type="button" onClick={clearIntroReferenceFiles}>清空已选参考论文</button>
                      </div>
                    ) : (
                      <p className="small">尚未选择参考论文 PDF。</p>
                    )}
                    <button className="button full" disabled={!introReferenceFiles.length} onClick={submitIntroReferencePapers}>上传参考论文并继续写作</button>
                  </div>
                ) : null}

                {selectedIntroRecord.literature_cards?.length ? (
                  <details className="card-soft">
                    <summary>参考论文轻量精读卡片</summary>
                    <MarkdownReport markdown={renderIntroValueAsMarkdown(selectedIntroRecord.literature_cards)} normalize={false} />
                  </details>
                ) : null}

                {selectedIntroRecord.gap_report ? (
                  <details className="card-soft">
                    <summary>领域痛点与普遍不足</summary>
                    <MarkdownReport markdown={renderIntroValueAsMarkdown(selectedIntroRecord.gap_report)} normalize={false} />
                  </details>
                ) : null}

                {shouldShowIntroInnovationSelection ? (
                  <div className="card-soft stack">
                    <h3>选择创新点候选</h3>
                    <p className="small">请选择你希望进入 Introduction 写作的创新点。建议选择 3 个；如果少于 3 个，也可以先提交。</p>
                    {(selectedIntroRecord.innovation_candidates || []).map((item, index) => {
                      const checked = selectedInnovationIndexes.includes(index);
                      return (
                        <label key={index} className="card-soft" style={{ display: "block" }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              setSelectedInnovationIndexes((previous) => {
                                if (event.target.checked) {
                                  return previous.includes(index) ? previous : [...previous, index].slice(0, 3);
                                }
                                return previous.filter((value) => value !== index);
                              });
                            }}
                          />{" "}
                          <strong>{innovationCandidateTitle(item, index)}</strong>
                          <MarkdownReport markdown={renderIntroValueAsMarkdown(item)} normalize={false} />
                        </label>
                      );
                    })}
                    <button className="button full" disabled={!selectedInnovationIndexes.length} onClick={submitSelectedInnovations}>提交已选择创新点并继续写作</button>
                  </div>
                ) : selectedIntroRecord.innovation_candidates?.length ? (
                  <details className="card-soft">
                    <summary>创新点候选</summary>
                    <MarkdownReport markdown={renderIntroValueAsMarkdown(selectedIntroRecord.innovation_candidates)} normalize={false} />
                  </details>
                ) : null}

                {selectedIntroRecord.innovation_validation_report ? (
                  <details className="card-soft">
                    <summary>创新点验证报告</summary>
                    <MarkdownReport markdown={renderIntroValueAsMarkdown(selectedIntroRecord.innovation_validation_report)} normalize={false} />
                  </details>
                ) : null}

                {selectedIntroRecord.intro_plan ? (
                  <details className="card-soft">
                    <summary>Introduction 大纲</summary>
                    <MarkdownReport markdown={renderIntroValueAsMarkdown(selectedIntroRecord.intro_plan)} normalize={false} />
                  </details>
                ) : null}

                {selectedIntroRecord.intro_draft ? (
                  <details className="card-soft">
                    <summary>Introduction 初稿 / 修订稿</summary>
                    <MarkdownReport markdown={selectedIntroRecord.intro_draft} normalize={false} />
                  </details>
                ) : null}

                {selectedIntroRecord.intro_review_report ? (
                  <details className="card-soft">
                    <summary>Reviewer 审查报告</summary>
                    <MarkdownReport markdown={renderIntroValueAsMarkdown(selectedIntroRecord.intro_review_report)} normalize={false} />
                  </details>
                ) : null}

                {selectedIntroRecord.final_introduction ? (
                  <div className="card-soft stack">
                    <div className="notice success">最终 Introduction 已生成。</div>
                    <MarkdownReport markdown={selectedIntroRecord.final_introduction} normalize={false} />
                    <button
                      className="button"
                      onClick={() => downloadText("final_introduction.md", selectedIntroRecord.final_introduction || "")}
                    >
                      下载 Introduction（Markdown）
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="notice">正在读取 Introduction 写作任务状态。</div>
            )}
          </div>
        ) : null}

        {view.type === "report" ? (
          <div className="card stack">
            <h2>{selectedReportMeta?.source_name || selectedReportMeta?.report_title || "历史报告"}</h2>
            {selectedPendingReport ? (
              <>
                <div className="notice">《{selectedReportMeta?.source_name || "未命名论文"}》当前状态：{selectedReportMeta?.progress_text || "后台任务正在运行中。"}</div>
                <AgentLogs logs={selectedReportLogs} />
              </>
            ) : selectedReportRecord ? (
              <>
                <AgentLogs logs={selectedReportLogs} />
                <AnalysisReportView analysisResult={selectedReportRecord} cacheKey={selectedReportMeta?.cache_key || view.reportId} sourceName={selectedReportMeta?.source_name || "历史报告"} statusText="历史报告已载入，无需重新解析。" />
              </>
            ) : (
              <div className="notice warning">报告仍在同步，稍后刷新可查看最终内容。</div>
            )}
          </div>
        ) : null}

        {batchRows.length ? (
          <div className="card stack">
            <h2>批量解析进度</h2>
            {batchRows.map((row) => (
              <div key={row.cache_key} className="card-soft">
                <strong>{row.status === "finished" ? "✅" : ["queued", "processing"].includes(row.status) ? "⏳" : "❌"} 第 {row.index} 篇《{row.source_name}》：</strong> {row.progress_text || row.status}
              </div>
            ))}
            {pendingRows.length ? <p className="small">后台任务正在继续运行。你可以关闭页面，稍后重新登录查看。</p> : null}
            {readyReports.length ? (
              <div className="stack">
                <h2>已完成解析结果</h2>
                {readyReports.map((report) => (
                  <div key={report.cache_key} className="card-soft">
                    <h3>第 {report.index} 篇论文：{report.source_name}</h3>
                    <AnalysisReportView analysisResult={report.analysis_result} sourceName={report.source_name} cacheKey={report.cache_key} />
                  </div>
                ))}
              </div>
            ) : null}
            <button className="button secondary" onClick={() => { setBatchRows([]); setReadyReports([]); clearSelectedPdfFiles(); setView({ type: "workspace" }); refreshHistories(); }}>返回当前工作区</button>
          </div>
        ) : null}
      </main>
    </div>
  );
}

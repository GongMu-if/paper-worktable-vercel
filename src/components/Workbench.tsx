"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  authenticateUser,
  createOrReuseAnalysisJob,
  createPaperSearchJob,
  ensureAppStorage,
  finalizePaperSearchJob,
  getPublicBackendConfig,
  getUserJobState,
  getUserSearchJobState,
  loadAgentLogs,
  loadUserReportIndex,
  loadUserReportRecord,
  loadUserSearchIndex,
  loadUserSearchRecord,
  markPaperSearchJobSuperseded,
  registerUser,
  submitAnalysisJob,
  submitPaperSearchJob,
  updateAnalysisJobStatus,
  updatePaperSearchJobStatus,
} from "@/lib/api";
import { buildExportFilename, getPdfCacheKey } from "@/lib/hash";
import type { AgentLog, AnalysisResult, BatchRow, ReadyReport, ReportMeta, SearchMeta, SearchRecord } from "@/lib/types";
import { MarkdownReport } from "./MarkdownReport";

const JOB_STATUS_REFRESH_INTERVAL_MS = 180000;
const DEFAULT_PREPRINT_RULE = "排除预印本 (仅限正规期刊/会议)";

type AppState = "IDLE" | "SEARCH_RUNNING" | "WAITING_FEEDBACK" | "COMPLETED";
type AuthMode = "login" | "register";
type MainView =
  | { type: "workspace" }
  | { type: "report"; reportId: string }
  | { type: "search"; searchJobId: string }
  | { type: "analysis-batch"; files: File[] };

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

function reportHistoryLabel(meta: ReportMeta): string {
  const displayName = meta.source_name || meta.report_title || "未命名论文";
  const shortName = shorten(displayName, 18);
  const status = (meta.status || "").toLowerCase();
  if (["queued", "processing"].includes(status)) return `${shortName}｜正在解析中`;
  if (status === "failed") return `${shortName}｜解析失败`;
  const timestamp = (meta.updated_at || meta.created_at || "").slice(0, 16);
  return timestamp ? `${shortName}｜${timestamp}` : shortName;
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
  selectedReportId,
  selectedSearchId,
  onRefresh,
  onLogout,
  onSelectWorkspace,
  onSelectReport,
  onSelectSearch,
}: {
  username: string;
  reports: ReportMeta[];
  searches: SearchMeta[];
  selectedReportId: string | null;
  selectedSearchId: string | null;
  onRefresh: () => void;
  onLogout: () => void;
  onSelectWorkspace: () => void;
  onSelectReport: (id: string) => void;
  onSelectSearch: (id: string) => void;
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
      </div>
    </div>
  );
}

export function Workbench() {
  const [currentUser, setCurrentUser] = useState("");
  const [configVersion, setConfigVersion] = useState("");
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [searches, setSearches] = useState<SearchMeta[]>([]);
  const [view, setView] = useState<MainView>({ type: "workspace" });
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);
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

  const usernameKey = useMemo(() => canonicalUsername(currentUser), [currentUser]);

  const refreshHistories = useCallback(async (username = currentUser) => {
    if (!username) return;
    const [reportIndex, searchIndex] = await Promise.all([
      loadUserReportIndex(username),
      loadUserSearchIndex(username),
    ]);
    setReports(reportIndex || []);
    setSearches(searchIndex || []);
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

  function login(username: string) {
    setCurrentUser(username);
    localStorage.setItem("paperseacrh_current_user", username);
    setView({ type: "workspace" });
  }

  function logout() {
    localStorage.removeItem("paperseacrh_current_user");
    setCurrentUser("");
    setReports([]);
    setSearches([]);
    setView({ type: "workspace" });
  }

  function resetWorkspace() {
    setSelectedReportId(null);
    setSelectedSearchId(null);
    setSelectedReportRecord(null);
    setSelectedReportMeta(null);
    setSelectedReportLogs([]);
    setSelectedSearchRecord(null);
    setView({ type: "workspace" });
  }

  async function startPaperSearch() {
    setError("");
    setMessage("");
    if (!searchTopic.trim()) {
      setError("请填写研究主题。");
      return;
    }
    try {
      resetWorkspace();
      setFinalResult("");
      setUiLogs([]);
      setHasProvidedFeedback(false);
      setFeedbackStartAt(null);
      setMessage("正在创建后台检索任务，并交由统一 Director 调度……");
      const job = await createPaperSearchJob({
        username: currentUser,
        userTopic: searchTopic,
        userRequirements: searchRequirements,
        preprintRule,
      });
      await submitPaperSearchJob(job.search_job_id);
      await updatePaperSearchJobStatus(job.search_job_id, "processing", "后台检索任务已提交，等待 Agent 完成候选文献筛选");
      setActiveSearchJobId(job.search_job_id);
      setCurrentSearchJobId(job.search_job_id);
      setAppState("SEARCH_RUNNING");
      setMessage("后台文献检索任务已提交。页面会自动轮询状态。关闭页面后仍可稍后重新登录查看结果。");
      await refreshHistories(currentUser);
    } catch (err) {
      setAppState("IDLE");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadReportView(reportId: string) {
    setError("");
    setSelectedReportId(reportId);
    setSelectedSearchId(null);
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
        setSearchTopic(record.meta.topic || "");
        setSearchRequirements(record.meta.requirements || "");
        setPreprintRule(record.meta.preprint_rule || DEFAULT_PREPRINT_RULE);
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
    setError("");
    setMessage("");
    setView({ type: "analysis-batch", files });
    setBatchRows([]);
    setReadyReports([]);
    if (!files.length) return;
    if (!configVersion) {
      setError("后端未返回 analysis_cache_version，无法生成 PDF 缓存键。");
      return;
    }

    const rows: BatchRow[] = [];
    const ready: ReadyReport[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const baseCacheKey = await getPdfCacheKey(file, configVersion);
      const cacheKey = `${baseCacheKey}:rerun:${Date.now()}:${index + 1}`;
      let row: BatchRow = {
        index: index + 1,
        source_name: file.name || `paper_${index + 1}.pdf`,
        cache_key: cacheKey,
        status: "processing",
        progress_text: "任务正在初始化中，请稍候。",
      };
      try {
        // 历史报告查重已关闭：不再读取 cached report，也不再复用同 cache_key 的旧任务。
        // 每次上传都生成一个带 rerun 后缀的新 cache_key，让后端创建全新的解析任务。
        const result = await createOrReuseAnalysisJob(currentUser, row.source_name, cacheKey);
        row = {
          ...row,
          report_id: result.job.report_id,
          status: result.job.status || "queued",
          progress_text: result.job.progress_text || "任务已创建。",
        };
        if (result.should_submit) {
          await submitAnalysisJob(result.job.report_id, row.source_name, cacheKey, file);
          await updateAnalysisJobStatus(result.job.report_id, "processing", "后台任务已启动，等待离线解析完成");
          row = { ...row, status: "processing", progress_text: "后台任务已创建，正在等待离线解析。" };
        }
        rows.push(row);
      } catch (err) {
        rows.push({ ...row, status: "failed", progress_text: err instanceof Error ? err.message : String(err) });
      }
    }
    setBatchRows(rows);
    setReadyReports(ready);
    await refreshHistories(currentUser);
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
      const job = await createPaperSearchJob({
        username: currentUser,
        userTopic: searchTopic,
        userRequirements: searchRequirements,
        preprintRule,
        feedback: newFeedback.trim(),
        previousResult: finalResult,
      });
      await markPaperSearchJobSuperseded(previousSearchJobId, job.search_job_id);
      await submitPaperSearchJob(job.search_job_id);
      await updatePaperSearchJobStatus(job.search_job_id, "processing", "修正检索任务已提交，等待 Agent 完成新一轮筛选");
      setActiveSearchJobId(job.search_job_id);
      setCurrentSearchJobId(job.search_job_id);
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
  const pendingRows = batchRows.filter((row) => ["queued", "processing"].includes((row.status || "").toLowerCase()));
  const selectedPendingReport = selectedReportMeta && ["queued", "processing"].includes((selectedReportMeta.status || "").toLowerCase());

  return (
    <div className="app-shell" key={usernameKey}>
      <Sidebar
        username={currentUser}
        reports={reports}
        searches={searches}
        selectedReportId={selectedReportId}
        selectedSearchId={selectedSearchId}
        onRefresh={() => refreshHistories()}
        onLogout={logout}
        onSelectWorkspace={() => {
          resetWorkspace();
          setAppState("IDLE");
        }}
        onSelectReport={loadReportView}
        onSelectSearch={loadSearchView}
      />
      <main className="main stack">
        {error ? <div className="notice error">{error}</div> : null}
        {message ? <div className="notice">{message}</div> : null}

        <section className="grid-2">
          <div className="card stack">
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

          <div className="card stack">
            <h2>论文精读入口</h2>
            <p className="muted">上传一篇或多篇 PDF，后端会分别生成结构化精读报告并保存到当前账号档案。</p>
            <input className="file-input" type="file" accept="application/pdf" multiple onChange={(event) => setPdfFiles(Array.from(event.target.files || []))} />
            <button className="button full" disabled={!pdfFiles.length} onClick={() => startAnalysis(pdfFiles)}>启动深度解析</button>
          </div>
        </section>

        {appState === "SEARCH_RUNNING" ? (
          <div className="card stack">
            <h2>文献检索运行中</h2>
            <div className="notice">{currentSearchState?.progress_text || "后台文献检索任务正在运行。页面会自动轮询状态。"}</div>
            <p className="small">任务已由后台接管。关闭页面后仍可稍后重新登录查看结果。</p>
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
                <div className="notice success">历史报告已载入，无需重新解析。</div>
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
            <button className="button secondary" onClick={() => { setBatchRows([]); setReadyReports([]); setPdfFiles([]); setView({ type: "workspace" }); refreshHistories(); }}>返回当前工作区</button>
          </div>
        ) : null}
      </main>
    </div>
  );
}

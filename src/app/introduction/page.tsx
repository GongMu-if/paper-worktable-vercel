"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getIntroJob,
  getIntroLogs,
  listIntroJobs,
  submitReferencePaper,
  submitSupportingPapers,
  type IntroJob,
} from "@/lib/introApi";

function getClientUserId() {
  if (typeof window === "undefined") return "";

  return (
    window.localStorage.getItem("user_id") ||
    window.localStorage.getItem("username") ||
    window.localStorage.getItem("current_user") ||
    "anonymous"
  );
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function shortText(value: string | undefined | null, fallback = "-") {
  const text = String(value || "").trim();
  return text || fallback;
}

function statusText(status?: string) {
  const value = String(status || "").toLowerCase();
  const map: Record<string, string> = {
    created: "已创建",
    queued: "排队中",
    processing: "处理中",
    awaiting_supporting_papers: "等待上传补充论文",
    finished: "已完成",
    failed: "失败",
    loading: "加载中",
    unknown: "未知",
  };
  return map[value] || status || "未知";
}

function stageText(stage?: string) {
  const value = String(stage || "").toLowerCase();
  const map: Record<string, string> = {
    created: "已创建",
    reference_submitted: "主论文已提交",
    reference_analysis: "主参考论文分析",
    same_problem_search: "同问题论文检索",
    awaiting_supporting_papers: "等待上传补充论文",
    supporting_paper_analysis: "补充论文分析",
    field_knowledge: "领域知识综合",
    citation_planning: "引用规划",
    introduction_writing: "英文 Introduction 写作",
    review_revision: "审稿与修改",
    finished: "已完成",
    reference_stage_failed: "主参考论文阶段失败",
    generation_stage_failed: "生成阶段失败",
  };
  return map[value] || stage || "等待中";
}

function 状态Badge({ status }: { status?: string }) {
  const value = String(status || "unknown").toLowerCase();
  return <span className={`intro-badge intro-badge-${value}`}>{statusText(status)}</span>;
}

function 阶段Pill({ stage }: { stage?: string }) {
  return <span className="intro-stage-pill">{stageText(stage)}</span>;
}

export default function IntroductionWriterPage() {
  const [userId, setUserId] = useState("");
  const [innovationText, setInnovationText] = useState("");
  const [mainFile, setMainFile] = useState<File | null>(null);

  const [supportFiles, setSupportFiles] = useState<File[]>([]);

  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<IntroJob | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [history, setHistory] = useState<IntroJob[]>([]);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const status = job?.status || "";
  const stage = job?.stage || "";

  const shouldPoll = useMemo(() => {
    return Boolean(jobId && ["queued", "processing"].includes(status));
  }, [jobId, status]);

  useEffect(() => {
    const uid = getClientUserId();
    setUserId(uid);
  }, []);

  async function refreshJob(currentJobId = jobId) {
    if (!currentJobId) return;

    const nextJob = await getIntroJob(currentJobId);
    setJob(nextJob);

    const nextLogs = await getIntroLogs(currentJobId);
    setLogs(nextLogs);
  }

  async function refreshHistory(uid = userId) {
    if (!uid) return;
    const items = await listIntroJobs(uid, 20);
    setHistory(items);
  }

  useEffect(() => {
    if (userId) {
      refreshHistory(userId).catch(() => {});
    }
  }, [userId]);

  useEffect(() => {
    if (!jobId) return;

    refreshJob(jobId).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error));
    });
  }, [jobId]);

  useEffect(() => {
    if (!shouldPoll) return;

    const timer = window.setInterval(() => {
      refreshJob(jobId).catch(() => {});
    }, 3000);

    return () => window.clearInterval(timer);
  }, [shouldPoll, jobId]);

  async function handleSubmitReference() {
    if (!mainFile) {
      setMessage("请上传主参考论文 PDF。");
      return;
    }

    if (!innovationText.trim()) {
      setMessage("请先填写创新点。");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const result = await submitReferencePaper({
        userId,
        innovationText,
        sourceName: mainFile.name,
        file: mainFile,
      });

      if (result?.job_id) {
        setJobId(result.job_id);
        setMessage("主参考论文已提交，系统正在分析。");
        await refreshHistory(userId);
      } else {
        setMessage(result?.message || "提交成功，但后端未返回任务 ID。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitSupporting() {
    if (!jobId) {
      setMessage("缺少任务 ID。");
      return;
    }

    if (supportFiles.length < 2 || supportFiles.length > 6) {
      setMessage("请上传 2-6 篇同问题或创新点相关补充论文。");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      await submitSupportingPapers({
        jobId,
        files: supportFiles,
      });

      setMessage("补充论文已提交，系统正在学习上传论文并生成英文 Introduction。");
      await refreshJob(jobId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  function downloadIntroduction() {
    const blob = new Blob([job?.final_introduction || ""], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "generated_introduction.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="intro-page">
      <style>{`
        :root {
          --intro-bg: #f5f7fb;
          --intro-card: rgba(255, 255, 255, 0.92);
          --intro-card-solid: #ffffff;
          --intro-border: #dfe5ef;
          --intro-border-strong: #c8d2e2;
          --intro-text: #152033;
          --intro-muted: #64748b;
          --intro-muted-2: #94a3b8;
          --intro-primary: #2563eb;
          --intro-primary-dark: #1d4ed8;
          --intro-primary-soft: #eff6ff;
          --intro-green: #16a34a;
          --intro-green-soft: #ecfdf5;
          --intro-red: #dc2626;
          --intro-red-soft: #fef2f2;
          --intro-yellow: #d97706;
          --intro-yellow-soft: #fffbeb;
          --intro-shadow: 0 20px 60px rgba(15, 23, 42, 0.10);
          --intro-shadow-soft: 0 10px 30px rgba(15, 23, 42, 0.08);
          --intro-radius: 22px;
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background:
            radial-gradient(circle at top left, rgba(37, 99, 235, 0.13), transparent 30%),
            radial-gradient(circle at 78% 12%, rgba(14, 165, 233, 0.12), transparent 28%),
            var(--intro-bg);
          color: var(--intro-text);
          font-family:
            Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
            "Segoe UI", "Microsoft YaHei", sans-serif;
        }

        .intro-page {
          min-height: 100vh;
          padding: 36px 24px 56px;
        }

        .intro-container {
          width: min(1180px, 100%);
          margin: 0 auto;
        }

        .intro-hero {
          position: relative;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.55fr);
          gap: 24px;
          padding: 34px;
          border: 1px solid rgba(203, 213, 225, 0.75);
          border-radius: 30px;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(239, 246, 255, 0.86)),
            linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(14, 165, 233, 0.07));
          box-shadow: var(--intro-shadow);
        }

        .intro-hero::after {
          content: "";
          position: absolute;
          right: -80px;
          top: -80px;
          width: 240px;
          height: 240px;
          border-radius: 999px;
          background: rgba(37, 99, 235, 0.11);
        }

        .intro-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: fit-content;
          padding: 8px 12px;
          border: 1px solid rgba(37, 99, 235, 0.18);
          border-radius: 999px;
          background: rgba(239, 246, 255, 0.8);
          color: var(--intro-primary-dark);
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .intro-kicker-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--intro-primary);
          box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.12);
        }

        .intro-title {
          margin: 18px 0 12px;
          color: #0f172a;
          font-size: clamp(34px, 4vw, 56px);
          line-height: 1.02;
          letter-spacing: -0.055em;
        }

        .intro-subtitle {
          max-width: 780px;
          margin: 0;
          color: var(--intro-muted);
          font-size: 16px;
          line-height: 1.7;
        }

        .intro-hero-side {
          position: relative;
          z-index: 1;
          display: grid;
          gap: 12px;
          align-content: center;
        }

        .intro-step-mini {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          padding: 14px;
          border: 1px solid rgba(203, 213, 225, 0.75);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.74);
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
        }

        .intro-step-index {
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          width: 30px;
          height: 30px;
          border-radius: 10px;
          background: #0f172a;
          color: white;
          font-size: 13px;
          font-weight: 800;
        }

        .intro-step-mini-title {
          margin: 0 0 3px;
          font-size: 13px;
          font-weight: 800;
        }

        .intro-step-mini-text {
          margin: 0;
          color: var(--intro-muted);
          font-size: 12px;
          line-height: 1.45;
        }

        .intro-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.55fr) minmax(320px, 0.75fr);
          gap: 22px;
          margin-top: 24px;
          align-items: start;
        }

        .intro-stack {
          display: grid;
          gap: 22px;
        }

        .intro-card {
          border: 1px solid var(--intro-border);
          border-radius: var(--intro-radius);
          background: var(--intro-card);
          box-shadow: var(--intro-shadow-soft);
          backdrop-filter: blur(8px);
        }

        .intro-card-header {
          display: flex;
          gap: 14px;
          align-items: center;
          justify-content: space-between;
          padding: 22px 24px 0;
        }

        .intro-card-title-wrap {
          min-width: 0;
        }

        .intro-card-title {
          margin: 0;
          color: #0f172a;
          font-size: 21px;
          line-height: 1.25;
          letter-spacing: -0.025em;
        }

        .intro-card-desc {
          margin: 7px 0 0;
          color: var(--intro-muted);
          font-size: 13px;
          line-height: 1.55;
        }

        .intro-card-body {
          padding: 22px 24px 24px;
        }

        .intro-form-grid {
          display: grid;
          gap: 16px;
        }

        .intro-label {
          display: block;
          margin-bottom: 8px;
          color: #334155;
          font-size: 13px;
          font-weight: 800;
        }

        .intro-textarea {
          display: block;
          width: 100%;
          min-height: 210px;
          resize: vertical;
          padding: 15px 16px;
          border: 1px solid var(--intro-border-strong);
          border-radius: 16px;
          background: #ffffff;
          color: var(--intro-text);
          font: inherit;
          font-size: 14px;
          line-height: 1.65;
          outline: none;
          transition: border-color 160ms ease, box-shadow 160ms ease;
        }

        .intro-textarea:focus {
          border-color: rgba(37, 99, 235, 0.65);
          box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
        }

        .intro-file-box {
          position: relative;
          display: flex;
          gap: 14px;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border: 1px dashed #b7c4d8;
          border-radius: 18px;
          background: linear-gradient(180deg, #ffffff, #f8fafc);
        }

        .intro-file-info {
          min-width: 0;
        }

        .intro-file-title {
          margin: 0;
          color: #0f172a;
          font-size: 14px;
          font-weight: 800;
        }

        .intro-file-name {
          margin: 4px 0 0;
          color: var(--intro-muted);
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .intro-file-input {
          max-width: 260px;
          color: var(--intro-muted);
          font-size: 13px;
        }

        .intro-button-row {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          margin-top: 4px;
        }

        .intro-button {
          appearance: none;
          border: 0;
          border-radius: 14px;
          padding: 12px 18px;
          background: var(--intro-primary);
          color: white;
          cursor: pointer;
          font: inherit;
          font-size: 14px;
          font-weight: 800;
          box-shadow: 0 12px 22px rgba(37, 99, 235, 0.22);
          transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
        }

        .intro-button:hover:not(:disabled) {
          transform: translateY(-1px);
          background: var(--intro-primary-dark);
          box-shadow: 0 16px 26px rgba(37, 99, 235, 0.26);
        }

        .intro-button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
          box-shadow: none;
        }

        .intro-button-secondary {
          border: 1px solid var(--intro-border-strong);
          background: white;
          color: #334155;
          box-shadow: none;
        }

        .intro-button-secondary:hover:not(:disabled) {
          background: #f8fafc;
          box-shadow: none;
        }

        .intro-message {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          padding: 14px 16px;
          border: 1px solid rgba(37, 99, 235, 0.16);
          border-radius: 18px;
          background: var(--intro-primary-soft);
          color: #1e3a8a;
          font-size: 13px;
          line-height: 1.55;
        }

        .intro-message-icon {
          display: grid;
          place-items: center;
          width: 24px;
          height: 24px;
          flex: 0 0 auto;
          border-radius: 8px;
          background: rgba(37, 99, 235, 0.15);
          font-weight: 900;
        }

        .intro-job-meta {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 16px;
        }

        .intro-meta-item {
          padding: 14px;
          border: 1px solid var(--intro-border);
          border-radius: 16px;
          background: #f8fafc;
        }

        .intro-meta-label {
          display: block;
          margin-bottom: 6px;
          color: var(--intro-muted);
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .intro-meta-value {
          display: block;
          min-width: 0;
          color: #0f172a;
          font-size: 13px;
          font-weight: 800;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .intro-badge {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          text-transform: capitalize;
        }

        .intro-badge-processing,
        .intro-badge-queued {
          background: var(--intro-yellow-soft);
          color: #92400e;
        }

        .intro-badge-awaiting_supporting_papers {
          background: var(--intro-primary-soft);
          color: #1d4ed8;
        }

        .intro-badge-finished {
          background: var(--intro-green-soft);
          color: #166534;
        }

        .intro-badge-failed {
          background: var(--intro-red-soft);
          color: #991b1b;
        }

        .intro-badge-unknown {
          background: #f1f5f9;
          color: #475569;
        }

        .intro-stage-pill {
          display: inline-flex;
          align-items: center;
          max-width: 100%;
          padding: 6px 10px;
          border: 1px solid var(--intro-border);
          border-radius: 999px;
          background: white;
          color: #334155;
          font-size: 12px;
          font-weight: 800;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .intro-progress-text,
        .intro-error-text {
          margin-top: 14px;
          padding: 14px 16px;
          border-radius: 16px;
          font-size: 13px;
          line-height: 1.6;
        }

        .intro-progress-text {
          border: 1px solid rgba(37, 99, 235, 0.14);
          background: var(--intro-primary-soft);
          color: #1e3a8a;
        }

        .intro-error-text {
          border: 1px solid rgba(220, 38, 38, 0.16);
          background: var(--intro-red-soft);
          color: #991b1b;
        }

        .intro-candidate-list {
          display: grid;
          gap: 12px;
        }

        .intro-candidate {
          padding: 16px;
          border: 1px solid var(--intro-border);
          border-radius: 18px;
          background: #ffffff;
        }

        .intro-candidate-title {
          margin: 0;
          color: #0f172a;
          font-size: 14px;
          font-weight: 900;
          line-height: 1.5;
        }

        .intro-candidate-meta {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 9px;
          color: var(--intro-muted);
          font-size: 12px;
        }

        .intro-candidate-reason {
          margin: 11px 0 0;
          color: #334155;
          font-size: 13px;
          line-height: 1.6;
        }

        .intro-candidate-url {
          display: block;
          margin-top: 10px;
          color: var(--intro-primary-dark);
          font-size: 12px;
          word-break: break-all;
        }

        .intro-empty {
          padding: 18px;
          border: 1px dashed var(--intro-border-strong);
          border-radius: 18px;
          background: #f8fafc;
          color: var(--intro-muted);
          font-size: 13px;
          line-height: 1.6;
        }

        .intro-output {
          padding: 22px;
          border: 1px solid var(--intro-border);
          border-radius: 18px;
          background: #ffffff;
          color: #172033;
          font-family: Georgia, "Times New Roman", serif;
          font-size: 16px;
          line-height: 1.85;
          white-space: pre-wrap;
        }

        .intro-details {
          margin-top: 14px;
          border: 1px solid var(--intro-border);
          border-radius: 16px;
          background: #ffffff;
          overflow: hidden;
        }

        .intro-details summary {
          cursor: pointer;
          padding: 14px 16px;
          color: #0f172a;
          font-size: 13px;
          font-weight: 900;
          user-select: none;
        }

        .intro-code {
          margin: 0;
          padding: 0 16px 16px;
          color: #334155;
          font-size: 12px;
          line-height: 1.55;
          white-space: pre-wrap;
          overflow: auto;
        }

        .intro-log-list {
          display: grid;
          gap: 10px;
        }

        .intro-log-item {
          padding: 12px 14px;
          border: 1px solid var(--intro-border);
          border-radius: 14px;
          background: #f8fafc;
          color: #334155;
          font-size: 12px;
          line-height: 1.55;
        }

        .intro-log-step {
          color: #0f172a;
          font-weight: 900;
        }

        .intro-history-list {
          display: grid;
          gap: 10px;
        }

        .intro-history-item {
          width: 100%;
          text-align: left;
          cursor: pointer;
          padding: 14px;
          border: 1px solid var(--intro-border);
          border-radius: 16px;
          background: #ffffff;
          transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
        }

        .intro-history-item:hover {
          transform: translateY(-1px);
          border-color: rgba(37, 99, 235, 0.35);
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
        }

        .intro-history-title {
          color: #0f172a;
          font-size: 13px;
          font-weight: 900;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .intro-history-meta {
          margin-top: 5px;
          color: var(--intro-muted);
          font-size: 12px;
        }

        .intro-sidebar {
          position: sticky;
          top: 20px;
          display: grid;
          gap: 22px;
        }

        @media (max-width: 920px) {
          .intro-page {
            padding: 20px 14px 40px;
          }

          .intro-hero,
          .intro-grid {
            grid-template-columns: 1fr;
          }

          .intro-hero {
            padding: 24px;
          }

          .intro-job-meta {
            grid-template-columns: 1fr;
          }

          .intro-file-box {
            align-items: stretch;
            flex-direction: column;
          }

          .intro-file-input {
            max-width: 100%;
          }

          .intro-sidebar {
            position: static;
          }
        }
      `}</style>

      <div className="intro-container">
        <section className="intro-hero">
          <div>
            <div className="intro-kicker">
              <span className="intro-kicker-dot" />
              英文 Introduction 写作链路
            </div>
            <h1 className="intro-title">英文 Introduction 生成器</h1>
            <p className="intro-subtitle">
              上传一篇主参考论文和你的创新点。系统会分析主论文、推荐同问题论文、学习三篇论文的领域知识、规划关键引用，并经过审稿修改后输出英文 Introduction。
            </p>
          </div>

          <div className="intro-hero-side">
            <div className="intro-step-mini">
              <div className="intro-step-index">1</div>
              <div>
                <p className="intro-step-mini-title">分析主参考论文</p>
                <p className="intro-step-mini-text">提取摘要、引言、讨论、结论和参考文献。</p>
              </div>
            </div>
            <div className="intro-step-mini">
              <div className="intro-step-index">2</div>
              <div>
                <p className="intro-step-mini-title">上传 2-6 篇补充论文</p>
                <p className="intro-step-mini-text">用于学习同问题领域知识和关键引用需求。</p>
              </div>
            </div>
            <div className="intro-step-mini">
              <div className="intro-step-index">3</div>
              <div>
                <p className="intro-step-mini-title">生成英文 Introduction</p>
                <p className="intro-step-mini-text">写作 Agent 与审稿 Agent 最多迭代 10 轮。</p>
              </div>
            </div>
          </div>
        </section>

        <div className="intro-grid">
          <div className="intro-stack">
            {message && (
              <div className="intro-message">
                <div className="intro-message-icon">i</div>
                <div>{message}</div>
              </div>
            )}

            <section className="intro-card">
              <div className="intro-card-header">
                <div className="intro-card-title-wrap">
                  <h2 className="intro-card-title">步骤 1 · 主参考论文与创新点</h2>
                  <p className="intro-card-desc">
                    这里可以填写中文创新点；最终生成的 Introduction 只会是英文。
                  </p>
                </div>
              </div>

              <div className="intro-card-body">
                <div className="intro-form-grid">
                  <div>
                    <label className="intro-label">创新点</label>
                    <textarea
                      value={innovationText}
                      onChange={(event) => setInnovationText(event.target.value)}
                      className="intro-textarea"
                      placeholder={
                        "请描述你的研究问题、任务对象、方法思路和 2–4 个创新点。例如：本文针对……问题，提出……方法，以解决……不足。"
                      }
                    />
                  </div>

                  <div>
                    <label className="intro-label">主参考论文 PDF</label>
                    <div className="intro-file-box">
                      <div className="intro-file-info">
                        <p className="intro-file-title">上传主参考论文</p>
                        <p className="intro-file-name">
                          {mainFile ? mainFile.name : "尚未选择文件"}
                        </p>
                      </div>
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={(event) => setMainFile(event.target.files?.[0] || null)}
                        className="intro-file-input"
                      />
                    </div>
                  </div>

                  <div className="intro-button-row">
                    <button
                      onClick={handleSubmitReference}
                      disabled={loading}
                      className="intro-button"
                    >
                      {loading ? "提交中..." : "分析主参考论文"}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {jobId && (
              <section className="intro-card">
                <div className="intro-card-header">
                  <div className="intro-card-title-wrap">
                    <h2 className="intro-card-title">当前任务</h2>
                    <p className="intro-card-desc">任务运行中页面会自动刷新状态。</p>
                  </div>
                  <button
                    onClick={() => refreshJob(jobId)}
                    className="intro-button intro-button-secondary"
                  >
                    刷新
                  </button>
                </div>

                <div className="intro-card-body">
                  <div className="intro-job-meta">
                    <div className="intro-meta-item">
                      <span className="intro-meta-label">任务 ID</span>
                      <span className="intro-meta-value" title={jobId}>{jobId}</span>
                    </div>
                    <div className="intro-meta-item">
                      <span className="intro-meta-label">状态</span>
                      <状态Badge status={status || "loading"} />
                    </div>
                    <div className="intro-meta-item">
                      <span className="intro-meta-label">阶段</span>
                      <阶段Pill stage={stage || "-"} />
                    </div>
                  </div>

                  {job?.progress_text && (
                    <div className="intro-progress-text">{job.progress_text}</div>
                  )}
                  {job?.error_text && (
                    <div className="intro-error-text">{job.error_text}</div>
                  )}
                </div>
              </section>
            )}

            {job?.status === "awaiting_supporting_papers" && (
              <section className="intro-card">
                <div className="intro-card-header">
                  <div className="intro-card-title-wrap">
                    <h2 className="intro-card-title">步骤 2 · 上传2-6 篇同问题或创新点相关补充论文</h2>
                    <p className="intro-card-desc">
                      可以参考系统推荐结果，也可以手动上传你认为最合适的2-6 篇同问题论文。
                    </p>
                  </div>
                </div>

                <div className="intro-card-body">
                  <div className="intro-candidate-list">
                    {Array.isArray(job.same_problem_candidates) &&
                    job.same_problem_candidates.length > 0 ? (
                      job.same_problem_candidates.slice(0, 10).map((item: any, index: number) => (
                        <div
                          key={`${item?.title || "candidate"}-${index}`}
                          className="intro-candidate"
                        >
                          <p className="intro-candidate-title">
                            {index + 1}. {item?.title || "未命名任务"}
                          </p>
                          <div className="intro-candidate-meta">
                            <span>年份：{item?.year || "-"}</span>
                            <span>关系：{item?.relation || "-"}</span>
                            <span>置信度：{item?.confidence ?? "-"}</span>
                          </div>
                          {item?.reason && (
                            <p className="intro-candidate-reason">{item.reason}</p>
                          )}
                          {item?.how_user_should_use_it && (
                            <p className="intro-candidate-reason">{item.how_user_should_use_it}</p>
                          )}
                          {item?.matched_innovation_points?.length > 0 && (
                            <p className="intro-candidate-reason">
                              匹配创新点：{item.matched_innovation_points.join("；")}
                            </p>
                          )}
                          {item?.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="intro-candidate-url"
                            >
                              {item.url}
                            </a>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="intro-empty">
                        没有检索到候选论文。你仍然可以手动上传 2-6 篇补充论文。
                      </div>
                    )}
                  </div>

                  <div style={{ height: 18 }} />

                  <div className="intro-form-grid">
                    <div>
                      <label className="intro-label">补充论文 PDF（2-6 篇）</label>
                      <div className="intro-file-box">
                        <div className="intro-file-info">
                          <p className="intro-file-title">批量上传补充论文</p>
                          <p className="intro-file-name">
                            {supportFiles.length > 0
                              ? `已选择 ${supportFiles.length} 篇：${supportFiles.map((file) => file.name).join("；")}`
                              : "尚未选择文件"}
                          </p>
                        </div>
                        <input
                          type="file"
                          accept="application/pdf"
                          multiple
                          onChange={(event) => {
                            const selectedFiles = Array.from(event.target.files || []);

                            setSupportFiles((prevFiles) => {
                              const mergedFiles = [...prevFiles, ...selectedFiles];

                              const uniqueFiles = Array.from(
                                new Map(
                                  mergedFiles.map((file) => [
                                    `${file.name}-${file.size}-${file.lastModified}`,
                                    file,
                                  ])
                                ).values()
                              );

                              return uniqueFiles.slice(0, 6);
                            });

                            event.target.value = "";
                          }}
                          className="intro-file-input"
                        />
                      </div>
                      <p className="intro-card-desc" style={{ marginTop: 8 }}>
                        可上传 2-6 篇。可以一次按住 Ctrl / Shift 多选，也可以多次点击“选择文件”逐篇追加。建议每个创新点匹配 1-2 篇文献，但不是必须每个创新点都上传两篇。
                      </p>
                    </div>

                    <div className="intro-button-row">
                      <button
                        onClick={handleSubmitSupporting}
                        disabled={loading}
                        className="intro-button"
                      >
                        {loading ? "提交中..." : "生成英文 Introduction"}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {job?.status === "finished" && (
              <section className="intro-card">
                <div className="intro-card-header">
                  <div className="intro-card-title-wrap">
                    <h2 className="intro-card-title">最终英文 Introduction</h2>
                    <p className="intro-card-desc">以下正文保持英文；审稿记录、引用规划和领域知识为中文辅助信息。</p>
                  </div>
                  <button
                    onClick={downloadIntroduction}
                    className="intro-button intro-button-secondary"
                  >
                    下载 Markdown
                  </button>
                </div>

                <div className="intro-card-body">
                  <div className="intro-output">
                    {job.final_introduction || "暂无 Introduction 输出。"}
                  </div>

                  <details className="intro-details">
                    <summary>最终引用 / 引用池</summary>
                    <pre className="intro-code">
                      {formatJson(job.final_references || job.citation_pool || [])}
                    </pre>
                  </details>

                  <details className="intro-details">
                    <summary>审稿历史</summary>
                    <pre className="intro-code">{formatJson(job.review_history || [])}</pre>
                  </details>

                  <details className="intro-details">
                    <summary>领域知识</summary>
                    <pre className="intro-code">{formatJson(job.field_knowledge || {})}</pre>
                  </details>
                </div>
              </section>
            )}
          </div>

          <aside className="intro-sidebar">
            <section className="intro-card">
              <div className="intro-card-header">
                <div className="intro-card-title-wrap">
                  <h2 className="intro-card-title">历史任务</h2>
                  <p className="intro-card-desc">当前浏览器用户的 Introduction 任务记录。</p>
                </div>
              </div>
              <div className="intro-card-body">
                {history.length > 0 ? (
                  <div className="intro-history-list">
                    {history.map((item: any) => (
                      <button
                        key={item.id}
                        onClick={() => setJobId(item.id)}
                        className="intro-history-item"
                      >
                        <div className="intro-history-title">
                          {shortText(item.main_pdf_name, "未命名任务")}
                        </div>
                        <div className="intro-history-meta">
                          {statusText(item.status)} · {stageText(item.stage)} ·{" "}
                          {shortText(item.created_at)}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="intro-empty">暂无 Introduction 任务。</div>
                )}
              </div>
            </section>

            {jobId && (
              <section className="intro-card">
                <div className="intro-card-header">
                  <div className="intro-card-title-wrap">
                    <h2 className="intro-card-title">执行日志</h2>
                    <p className="intro-card-desc">后端 Agent 的运行步骤和审稿进度。</p>
                  </div>
                </div>
                <div className="intro-card-body">
                  {logs.length > 0 ? (
                    <div className="intro-log-list">
                      {logs.map((log, index) => (
                        <div key={index} className="intro-log-item">
                          <span className="intro-log-step">
                            [{log?.step_no ?? index + 1}]
                          </span>{" "}
                          {log?.stage || "-"} · {log?.status || "-"}
                          <br />
                          {log?.message || ""}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="intro-empty">暂无日志。</div>
                  )}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}

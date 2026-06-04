// src/app/reviewer/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchReviewerJob,
  ReviewJobStatus,
  ReviewUploadMeta,
  submitReviewerJob,
  uploadReviewerPdf,
} from "@/lib/reviewerApi";

type UiStatus =
  | "idle"
  | "uploading"
  | "submitted"
  | "running"
  | "completed"
  | "failed";

function statusText(status?: string | null) {
  const map: Record<string, string> = {
    queued: "等待处理",
    processing: "处理中",
    completed: "已完成",
    completed_with_errors: "完成但有失败项",
    failed: "失败",
  };
  return map[String(status || "")] || status || "未知";
}

function statusBadgeClass(status?: string | null) {
  const value = String(status || "unknown");
  if (value === "completed") return "reviewer-status-completed";
  if (value === "completed_with_errors") return "reviewer-status-warning";
  if (value === "failed") return "reviewer-status-failed";
  if (value === "processing") return "reviewer-status-processing";
  if (value === "queued") return "reviewer-status-queued";
  return "reviewer-status-unknown";
}

function formatFileSize(size: number) {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function splitReportItem(item: string) {
  const lines = String(item || "").split(/\r?\n/);
  const title = (lines.shift() || "").trim();
  const body = lines.join("\n").trimStart();
  return { title, body };
}

export default function ReviewerPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<UiStatus>("idle");
  const [message, setMessage] = useState(
    "请选择需要审稿的 PDF 文件。支持批量上传。",
  );
  const [jobId, setJobId] = useState<string>("");
  const [jobState, setJobState] = useState<ReviewJobStatus | null>(null);
  const [error, setError] = useState<string>("");
  const pollingRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isBusy =
    status === "uploading" || status === "running" || status === "submitted";

  const progress = useMemo(() => {
    const job = jobState?.job;
    if (!job || !job.paper_count) return 0;
    return Math.round(((job.completed_count || 0) / job.paper_count) * 100);
  }, [jobState]);

  const completedCount = jobState?.job?.completed_count || 0;
  const paperCount = jobState?.job?.paper_count || files.length || 0;
  const failedCount = jobState?.job?.failed_count || 0;

  function clearPolling() {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  async function poll(id: string) {
    const state = await fetchReviewerJob(id);
    setJobState(state);
    setMessage(state.job.message || statusText(state.job.status));
    if (
      ["completed", "completed_with_errors", "failed"].includes(
        state.job.status,
      )
    ) {
      clearPolling();
      setStatus(state.job.status === "failed" ? "failed" : "completed");
    } else {
      setStatus("running");
    }
  }

  function startPolling(id: string) {
    clearPolling();
    poll(id).catch((e) => setError(e.message || String(e)));
    pollingRef.current = window.setInterval(() => {
      poll(id).catch((e) => setError(e.message || String(e)));
    }, 3000);
  }

  useEffect(() => clearPolling, []);

  function addFiles(selected: File[]) {
    const pdfs = selected.filter(
      (file) =>
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf"),
    );
    setFiles((prev) => {
      const next = [...prev];
      for (const file of pdfs) {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        if (
          !next.some(
            (item) => `${item.name}-${item.size}-${item.lastModified}` === key,
          )
        ) {
          next.push(file);
        }
      }
      return next;
    });
    if (pdfs.length !== selected.length) {
      setError("已自动忽略非 PDF 文件。");
    } else {
      setError("");
    }
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== index));
  }

  function handlePageRefresh() {
    clearPolling();
    window.location.reload();
  }

  async function handleSubmit() {
    try {
      setError("");
      if (!files.length) {
        setError("请至少选择一个 PDF 文件。");
        return;
      }
      setStatus("uploading");
      setMessage(`正在上传 ${files.length} 个 PDF 到 Supabase Storage...`);

      const uploaded: ReviewUploadMeta[] = [];
      for (let i = 0; i < files.length; i++) {
        setMessage(`正在上传：${files[i].name}（${i + 1}/${files.length}）`);
        uploaded.push(await uploadReviewerPdf(files[i]));
      }

      setStatus("submitted");
      setMessage("上传完成，正在提交 Modal 审稿任务...");
      const { jobId } = await submitReviewerJob(uploaded);
      setJobId(jobId);
      setMessage("任务已提交，正在处理...");
      startPolling(jobId);
    } catch (e: any) {
      setStatus("failed");
      setError(e?.message || String(e));
      setMessage("任务失败");
      clearPolling();
    }
  }

  return (
    <main className="reviewer-page">
      <style>{`
        :root {
          --reviewer-bg: #f5f7fb;
          --reviewer-card: rgba(255, 255, 255, 0.92);
          --reviewer-card-solid: #ffffff;
          --reviewer-border: #dfe5ef;
          --reviewer-border-strong: #c8d2e2;
          --reviewer-text: #152033;
          --reviewer-muted: #64748b;
          --reviewer-muted-2: #94a3b8;
          --reviewer-primary: #2563eb;
          --reviewer-primary-dark: #1d4ed8;
          --reviewer-primary-soft: #eff6ff;
          --reviewer-green: #16a34a;
          --reviewer-green-soft: #ecfdf5;
          --reviewer-red: #dc2626;
          --reviewer-red-soft: #fef2f2;
          --reviewer-yellow: #d97706;
          --reviewer-yellow-soft: #fffbeb;
          --reviewer-shadow: 0 20px 60px rgba(15, 23, 42, 0.10);
          --reviewer-shadow-soft: 0 10px 30px rgba(15, 23, 42, 0.08);
          --reviewer-radius: 22px;
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background:
            radial-gradient(circle at top left, rgba(37, 99, 235, 0.13), transparent 30%),
            radial-gradient(circle at 78% 12%, rgba(14, 165, 233, 0.12), transparent 28%),
            var(--reviewer-bg);
          color: var(--reviewer-text);
          font-family:
            Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
            "Segoe UI", "Microsoft YaHei", sans-serif;
        }

        .reviewer-page {
          min-height: 100vh;
          padding: 36px 24px 56px;
          background:
            radial-gradient(circle at top left, rgba(37, 99, 235, 0.13), transparent 30%),
            radial-gradient(circle at 78% 12%, rgba(14, 165, 233, 0.12), transparent 28%),
            var(--reviewer-bg);
          color: var(--reviewer-text);
          font-family:
            Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
            "Segoe UI", "Microsoft YaHei", sans-serif;
        }

        .reviewer-container {
          width: min(1180px, 100%);
          margin: 0 auto;
        }

        .reviewer-hero {
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
          box-shadow: var(--reviewer-shadow);
        }

        .reviewer-hero::after {
          content: "";
          position: absolute;
          right: -80px;
          top: -80px;
          width: 240px;
          height: 240px;
          border-radius: 999px;
          background: rgba(37, 99, 235, 0.11);
        }

        .reviewer-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: fit-content;
          padding: 8px 12px;
          border: 1px solid rgba(37, 99, 235, 0.18);
          border-radius: 999px;
          background: rgba(239, 246, 255, 0.8);
          color: var(--reviewer-primary-dark);
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.02em;
        }

        .reviewer-kicker-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--reviewer-primary);
          box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.12);
        }

        .reviewer-title {
          margin: 18px 0 12px;
          color: #0f172a;
          font-size: clamp(34px, 4vw, 56px);
          line-height: 1.02;
          letter-spacing: -0.055em;
        }

        .reviewer-subtitle {
          max-width: 780px;
          margin: 0;
          color: var(--reviewer-muted);
          font-size: 16px;
          line-height: 1.7;
        }

        .reviewer-hero-side {
          position: relative;
          z-index: 1;
          display: grid;
          gap: 12px;
          align-content: center;
        }

        .reviewer-step-mini {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          padding: 14px;
          border: 1px solid rgba(203, 213, 225, 0.75);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.74);
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
        }

        .reviewer-step-index {
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          width: 30px;
          height: 30px;
          border-radius: 10px;
          background: #0f172a;
          color: white;
          font-size: 13px;
          font-weight: 900;
        }

        .reviewer-step-mini-title {
          margin: 0 0 3px;
          color: #0f172a;
          font-size: 13px;
          font-weight: 900;
        }

        .reviewer-step-mini-text {
          margin: 0;
          color: var(--reviewer-muted);
          font-size: 12px;
          line-height: 1.45;
        }

        .reviewer-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
          gap: 22px;
          margin-top: 24px;
          align-items: start;
        }

        .reviewer-stack {
          display: grid;
          gap: 22px;
        }

        .reviewer-sidebar {
          position: sticky;
          top: 20px;
          display: grid;
          gap: 22px;
        }

        .reviewer-card {
          border: 1px solid var(--reviewer-border);
          border-radius: var(--reviewer-radius);
          background: var(--reviewer-card);
          box-shadow: var(--reviewer-shadow-soft);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }

        .reviewer-card-header {
          display: flex;
          gap: 14px;
          align-items: flex-start;
          justify-content: space-between;
          padding: 22px 24px 0;
        }

        .reviewer-card-title {
          margin: 0;
          color: #0f172a;
          font-size: 21px;
          line-height: 1.25;
          letter-spacing: -0.025em;
        }

        .reviewer-card-desc {
          margin: 7px 0 0;
          color: var(--reviewer-muted);
          font-size: 13px;
          line-height: 1.55;
        }

        .reviewer-card-body {
          padding: 22px 24px 24px;
        }

        .reviewer-selected-count {
          display: grid;
          place-items: center;
          min-width: 86px;
          padding: 12px 14px;
          border-radius: 18px;
          background: #0f172a;
          color: white;
          text-align: center;
        }

        .reviewer-selected-label {
          color: #cbd5e1;
          font-size: 12px;
          font-weight: 800;
        }

        .reviewer-selected-value {
          margin-top: 2px;
          font-size: 26px;
          font-weight: 950;
          line-height: 1;
        }

        .reviewer-hidden-input {
          display: none;
        }

        .reviewer-dropzone {
          cursor: pointer;
          display: grid;
          place-items: center;
          min-height: 238px;
          padding: 28px;
          border: 1.5px dashed #b7c4d8;
          border-radius: 22px;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.9)),
            radial-gradient(circle at center, rgba(37, 99, 235, 0.08), transparent 52%);
          text-align: center;
          outline: none;
          transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
        }

        .reviewer-dropzone:hover,
        .reviewer-dropzone:focus-visible {
          transform: translateY(-1px);
          border-color: rgba(37, 99, 235, 0.65);
          background: linear-gradient(180deg, #ffffff, #eff6ff);
          box-shadow: 0 14px 34px rgba(37, 99, 235, 0.10);
        }

        .reviewer-drop-icon {
          display: grid;
          place-items: center;
          width: 58px;
          height: 58px;
          border-radius: 18px;
          background: var(--reviewer-primary);
          color: white;
          font-size: 28px;
          font-weight: 900;
          box-shadow: 0 15px 28px rgba(37, 99, 235, 0.25);
        }

        .reviewer-drop-title {
          margin-top: 16px;
          color: #0f172a;
          font-size: 18px;
          font-weight: 950;
        }

        .reviewer-drop-text {
          margin-top: 8px;
          color: var(--reviewer-muted);
          font-size: 13px;
          line-height: 1.55;
        }

        .reviewer-button-row {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          margin-top: 18px;
          justify-content: center;
        }

        .reviewer-button {
          appearance: none;
          border: 0;
          border-radius: 14px;
          padding: 12px 18px;
          background: var(--reviewer-primary);
          color: white;
          cursor: pointer;
          font: inherit;
          font-size: 14px;
          font-weight: 900;
          box-shadow: 0 12px 22px rgba(37, 99, 235, 0.22);
          transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease, opacity 160ms ease;
        }

        .reviewer-button:hover:not(:disabled) {
          transform: translateY(-1px);
          background: var(--reviewer-primary-dark);
          box-shadow: 0 16px 26px rgba(37, 99, 235, 0.26);
        }

        .reviewer-button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
          box-shadow: none;
        }

        .reviewer-button-secondary {
          border: 1px solid var(--reviewer-border-strong);
          background: white;
          color: #334155;
          box-shadow: none;
        }

        .reviewer-button-secondary:hover:not(:disabled) {
          background: #f8fafc;
          box-shadow: none;
        }

        .reviewer-submit-button {
          width: 100%;
          margin-top: 18px;
          padding: 15px 18px;
          border-radius: 18px;
          font-size: 15px;
        }

        .reviewer-file-list {
          margin-top: 18px;
          padding: 16px;
          border: 1px solid var(--reviewer-border);
          border-radius: 20px;
          background: #ffffff;
        }

        .reviewer-file-list-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }

        .reviewer-file-list-title {
          color: #0f172a;
          font-size: 14px;
          font-weight: 900;
        }

        .reviewer-link-button {
          appearance: none;
          border: 0;
          background: transparent;
          color: var(--reviewer-muted-2);
          cursor: pointer;
          font: inherit;
          font-size: 13px;
          font-weight: 900;
          transition: color 160ms ease;
        }

        .reviewer-link-button:hover:not(:disabled) {
          color: var(--reviewer-red);
        }

        .reviewer-link-button:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }

        .reviewer-file-items {
          display: grid;
          gap: 10px;
        }

        .reviewer-file-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 12px 14px;
          border: 1px solid #edf2f7;
          border-radius: 16px;
          background: #f8fafc;
        }

        .reviewer-file-main {
          min-width: 0;
        }

        .reviewer-file-name {
          color: #0f172a;
          font-size: 13px;
          font-weight: 900;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .reviewer-file-size {
          margin-top: 4px;
          color: var(--reviewer-muted-2);
          font-size: 12px;
        }

        .reviewer-remove-button {
          appearance: none;
          flex: 0 0 auto;
          border: 0;
          border-radius: 10px;
          padding: 7px 10px;
          background: transparent;
          color: var(--reviewer-muted-2);
          cursor: pointer;
          font: inherit;
          font-size: 13px;
          font-weight: 900;
          transition: background 160ms ease, color 160ms ease;
        }

        .reviewer-remove-button:hover:not(:disabled) {
          background: var(--reviewer-red-soft);
          color: var(--reviewer-red);
        }

        .reviewer-remove-button:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }

        .reviewer-error {
          margin-top: 16px;
          padding: 14px 16px;
          border: 1px solid rgba(220, 38, 38, 0.16);
          border-radius: 18px;
          background: var(--reviewer-red-soft);
          color: #991b1b;
          font-size: 13px;
          font-weight: 800;
          line-height: 1.55;
        }

        .reviewer-progress-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .reviewer-progress-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 0 0 auto;
        }

        .reviewer-page-refresh-button {
          padding: 10px 14px;
          border-radius: 12px;
          font-size: 13px;
        }

        .reviewer-progress-circle {
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          width: 66px;
          height: 66px;
          border-radius: 20px;
          background: #0f172a;
          color: white;
          font-size: 18px;
          font-weight: 950;
        }

        .reviewer-progress-track {
          overflow: hidden;
          height: 12px;
          margin-top: 20px;
          border-radius: 999px;
          background: #eaf0f7;
        }

        .reviewer-progress-bar {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #2563eb, #06b6d4);
          transition: width 500ms ease;
        }

        .reviewer-stat-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-top: 16px;
        }

        .reviewer-stat {
          padding: 14px;
          border-radius: 18px;
          text-align: center;
          background: #f8fafc;
        }

        .reviewer-stat-green {
          background: var(--reviewer-green-soft);
        }

        .reviewer-stat-red {
          background: var(--reviewer-red-soft);
        }

        .reviewer-stat-value {
          color: #0f172a;
          font-size: 22px;
          font-weight: 950;
          line-height: 1;
        }

        .reviewer-stat-green .reviewer-stat-value {
          color: #166534;
        }

        .reviewer-stat-red .reviewer-stat-value {
          color: #991b1b;
        }

        .reviewer-stat-label {
          margin-top: 7px;
          color: var(--reviewer-muted);
          font-size: 12px;
          font-weight: 800;
        }

        .reviewer-job-id {
          margin-top: 14px;
          padding: 12px 14px;
          border: 1px solid var(--reviewer-border);
          border-radius: 14px;
          background: #f8fafc;
          color: var(--reviewer-muted);
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .reviewer-queue-list {
          display: grid;
          gap: 12px;
          margin-top: 18px;
        }

        .reviewer-queue-item {
          padding: 15px;
          border: 1px solid var(--reviewer-border);
          border-radius: 18px;
          background: #ffffff;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04);
        }

        .reviewer-queue-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .reviewer-queue-main {
          min-width: 0;
        }

        .reviewer-queue-name {
          color: #0f172a;
          font-size: 13px;
          font-weight: 950;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .reviewer-queue-message {
          margin-top: 5px;
          color: var(--reviewer-muted);
          font-size: 12px;
          line-height: 1.5;
        }

        .reviewer-status-badge {
          display: inline-flex;
          align-items: center;
          flex: 0 0 auto;
          width: fit-content;
          padding: 6px 10px;
          border: 1px solid transparent;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 950;
          white-space: nowrap;
        }

        .reviewer-status-completed {
          border-color: #bbf7d0;
          background: var(--reviewer-green-soft);
          color: #166534;
        }

        .reviewer-status-warning,
        .reviewer-status-queued {
          border-color: #fde68a;
          background: var(--reviewer-yellow-soft);
          color: #92400e;
        }

        .reviewer-status-failed {
          border-color: #fecaca;
          background: var(--reviewer-red-soft);
          color: #991b1b;
        }

        .reviewer-status-processing {
          border-color: #bfdbfe;
          background: var(--reviewer-primary-soft);
          color: #1d4ed8;
        }

        .reviewer-status-unknown {
          border-color: #e2e8f0;
          background: #f8fafc;
          color: #475569;
        }

        .reviewer-queue-error {
          margin-top: 12px;
          padding: 12px;
          border-radius: 14px;
          background: var(--reviewer-red-soft);
          color: #991b1b;
          font-size: 12px;
          line-height: 1.5;
        }

        .reviewer-empty {
          margin-top: 18px;
          padding: 26px 18px;
          border: 1px dashed var(--reviewer-border-strong);
          border-radius: 18px;
          background: #f8fafc;
          color: var(--reviewer-muted);
          text-align: center;
          font-size: 13px;
          line-height: 1.6;
        }

        .reviewer-final {
          margin-top: 22px;
        }

        .reviewer-final-header {
          display: flex;
          gap: 14px;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          padding: 22px 24px 0;
        }

        .reviewer-output {
          max-height: 760px;
          overflow: auto;
          margin: 0;
          padding: 0 4px;
          color: #172033;
          font-family:
            Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
            "Segoe UI", "Microsoft YaHei", sans-serif;
          font-size: 15px;
          line-height: 1.9;
        }

        .reviewer-report-item {
          padding: 10px 0 28px;
          border-bottom: 1px solid var(--reviewer-border);
        }

        .reviewer-report-item:last-child {
          padding-bottom: 0;
          border-bottom: 0;
        }

        .reviewer-report-title {
          margin: 0 0 18px;
          color: #0f172a;
          font-size: 18px;
          font-weight: 950;
          line-height: 1.55;
        }

        .reviewer-report-body {
          white-space: pre-wrap;
        }

        @media (max-width: 920px) {
          .reviewer-page {
            padding: 20px 14px 40px;
          }

          .reviewer-hero,
          .reviewer-grid {
            grid-template-columns: 1fr;
          }

          .reviewer-hero {
            padding: 24px;
          }

          .reviewer-sidebar {
            position: static;
          }

          .reviewer-selected-count {
            display: none;
          }
        }

        @media (max-width: 560px) {
          .reviewer-card-header,
          .reviewer-card-body,
          .reviewer-final-header {
            padding-left: 18px;
            padding-right: 18px;
          }

          .reviewer-stat-grid {
            grid-template-columns: 1fr;
          }

          .reviewer-progress-head,
          .reviewer-queue-top,
          .reviewer-file-item {
            align-items: stretch;
            flex-direction: column;
          }

          .reviewer-progress-actions {
            justify-content: space-between;
            width: 100%;
          }

          .reviewer-status-badge,
          .reviewer-remove-button {
            width: fit-content;
          }
        }
      `}</style>

      <div className="reviewer-container">
        <section className="reviewer-hero">
          <div>
            <div className="reviewer-kicker">
              <span className="reviewer-kicker-dot" />
              Journal of Control and Decision 审稿辅助
            </div>
            <h1 className="reviewer-title">批量论文审稿 Agent</h1>
            <p className="reviewer-subtitle">
              上传多篇 PDF
              后，系统并行解析文本，判断是否符合期刊收录方向，并输出三段式审稿意见：整体评价、中文评语、英文学术翻译。
            </p>
          </div>

          <div className="reviewer-hero-side">
            {[
              ["1", "批量上传", "多篇 PDF 上传至 Supabase Storage"],
              ["2", "并行审稿", "Modal 后端并行解析文本与生成意见"],
              ["3", "三段输出", "整体评价、中文评语、英文翻译"],
            ].map(([num, title, desc]) => (
              <div key={num} className="reviewer-step-mini">
                <div className="reviewer-step-index">{num}</div>
                <div>
                  <p className="reviewer-step-mini-title">{title}</p>
                  <p className="reviewer-step-mini-text">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="reviewer-grid">
          <section className="reviewer-card">
            <div className="reviewer-card-header">
              <div>
                <h2 className="reviewer-card-title">步骤 1 · 上传待审论文</h2>
                <p className="reviewer-card-desc">
                  支持批量上传
                  PDF。前端只显示实时进度，最终汇总每篇论文的审稿意见。
                </p>
              </div>
              <div className="reviewer-selected-count">
                <div className="reviewer-selected-label">已选择</div>
                <div className="reviewer-selected-value">{files.length}</div>
              </div>
            </div>

            <div className="reviewer-card-body">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={(event) =>
                  addFiles(Array.from(event.target.files || []))
                }
                className="reviewer-hidden-input"
              />

              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ")
                    fileInputRef.current?.click();
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  addFiles(Array.from(event.dataTransfer.files || []));
                }}
                className="reviewer-dropzone"
              >
                <div>
                  <div className="reviewer-drop-icon">↑</div>
                  <div className="reviewer-drop-title">
                    点击选择 PDF，或拖拽文件到这里
                  </div>
                  <div className="reviewer-drop-text">
                    仅接收 PDF 文件，可一次上传多篇论文。
                  </div>
                  <div className="reviewer-button-row">
                    <button
                      type="button"
                      className="reviewer-button reviewer-button-secondary"
                    >
                      选择 PDF 文件
                    </button>
                  </div>
                </div>
              </div>

              {files.length > 0 && (
                <div className="reviewer-file-list">
                  <div className="reviewer-file-list-header">
                    <div className="reviewer-file-list-title">待审稿文件</div>
                    <button
                      type="button"
                      onClick={() => setFiles([])}
                      disabled={isBusy}
                      className="reviewer-link-button"
                    >
                      清空
                    </button>
                  </div>
                  <div className="reviewer-file-items">
                    {files.map((file, index) => (
                      <div
                        key={`${file.name}-${file.size}-${file.lastModified}`}
                        className="reviewer-file-item"
                      >
                        <div className="reviewer-file-main">
                          <div className="reviewer-file-name">{file.name}</div>
                          <div className="reviewer-file-size">
                            {formatFileSize(file.size)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFile(index)}
                          disabled={isBusy}
                          className="reviewer-remove-button"
                        >
                          移除
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && <div className="reviewer-error">{error}</div>}

              <button
                onClick={handleSubmit}
                disabled={isBusy || !files.length}
                className="reviewer-button reviewer-submit-button"
              >
                {isBusy ? "任务处理中..." : "开始批量审稿"}
              </button>
            </div>
          </section>

          <aside className="reviewer-sidebar">
            <section className="reviewer-card">
              <div className="reviewer-card-header">
                <div>
                  <h2 className="reviewer-card-title">实时进度</h2>
                  <p className="reviewer-card-desc">{message}</p>
                </div>
                <div className="reviewer-progress-actions">
                  <button
                    type="button"
                    onClick={handlePageRefresh}
                    className="reviewer-button reviewer-button-secondary reviewer-page-refresh-button"
                  >
                    刷新页面
                  </button>
                  <div className="reviewer-progress-circle">{progress}%</div>
                </div>
              </div>

              <div className="reviewer-card-body">
                <div className="reviewer-progress-track">
                  <div
                    className="reviewer-progress-bar"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="reviewer-stat-grid">
                  <div className="reviewer-stat">
                    <div className="reviewer-stat-value">{paperCount}</div>
                    <div className="reviewer-stat-label">总论文</div>
                  </div>
                  <div className="reviewer-stat reviewer-stat-green">
                    <div className="reviewer-stat-value">{completedCount}</div>
                    <div className="reviewer-stat-label">已完成</div>
                  </div>
                  <div className="reviewer-stat reviewer-stat-red">
                    <div className="reviewer-stat-value">{failedCount}</div>
                    <div className="reviewer-stat-label">失败</div>
                  </div>
                </div>

                {jobId && (
                  <div className="reviewer-job-id">Job ID: {jobId}</div>
                )}
              </div>
            </section>

            <section className="reviewer-card">
              <div className="reviewer-card-header">
                <div>
                  <h2 className="reviewer-card-title">处理队列</h2>
                  <p className="reviewer-card-desc">
                    每篇论文独立并行处理，完成后自动汇总结果。
                  </p>
                </div>
              </div>

              <div className="reviewer-card-body">
                {jobState?.papers?.length ? (
                  <div className="reviewer-queue-list">
                    {jobState.papers.map((paper) => (
                      <div key={paper.id} className="reviewer-queue-item">
                        <div className="reviewer-queue-top">
                          <div className="reviewer-queue-main">
                            <div className="reviewer-queue-name">
                              {paper.file_name}
                            </div>
                            <div className="reviewer-queue-message">
                              {paper.message || "等待后端返回状态"}
                            </div>
                          </div>
                          <span
                            className={`reviewer-status-badge ${statusBadgeClass(paper.status)}`}
                          >
                            {statusText(paper.status)}
                          </span>
                        </div>
                        {paper.error && (
                          <div className="reviewer-queue-error">
                            {paper.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="reviewer-empty">暂无审稿任务。</div>
                )}
              </div>
            </section>
          </aside>
        </div>

        {jobState?.job?.final_result && (
          <section className="reviewer-card reviewer-final">
            <div className="reviewer-final-header">
              <div>
                <h2 className="reviewer-card-title">最终审稿意见</h2>
                <p className="reviewer-card-desc">
                  按照论文顺序汇总展示，可直接复制用于进一步整理。
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard?.writeText(
                    jobState.job.final_result || "",
                  )
                }
                className="reviewer-button reviewer-button-secondary"
              >
                复制结果
              </button>
            </div>
            <div className="reviewer-card-body">
              <div className="reviewer-output">
                {(jobState.job.final_result || "")
                  .split(/\n\n---\n\n/g)
                  .filter(Boolean)
                  .map((item, index) => (
                    <article key={index} className="reviewer-report-item">
                      {(() => {
                        const report = splitReportItem(item);
                        return (
                          <>
                            {report.title && (
                              <h3 className="reviewer-report-title">
                                {report.title}
                              </h3>
                            )}
                            {report.body && (
                              <div className="reviewer-report-body">
                                {report.body}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </article>
                  ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

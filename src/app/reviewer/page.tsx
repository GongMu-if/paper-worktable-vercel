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

type UiStatus = "idle" | "uploading" | "submitted" | "running" | "completed" | "failed";

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

export default function ReviewerPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<UiStatus>("idle");
  const [message, setMessage] = useState("请选择需要审稿的 PDF 文件。支持批量上传。");
  const [jobId, setJobId] = useState<string>("");
  const [jobState, setJobState] = useState<ReviewJobStatus | null>(null);
  const [error, setError] = useState<string>("");
  const pollingRef = useRef<number | null>(null);

  const progress = useMemo(() => {
    const job = jobState?.job;
    if (!job || !job.paper_count) return 0;
    return Math.round(((job.completed_count || 0) / job.paper_count) * 100);
  }, [jobState]);

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
    if (["completed", "completed_with_errors", "failed"].includes(state.job.status)) {
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
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-400">Journal of Control and Decision</p>
          <h1 className="text-3xl font-semibold tracking-tight">批量论文审稿 Agent</h1>
          <p className="max-w-3xl text-slate-300">
            上传多篇 PDF 后，系统会并行解析文本、判断期刊收录范围，并生成三段式审稿意见：整体评价、中文评语、英文学术翻译。
          </p>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-200">上传 PDF 论文</label>
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files || []))}
              className="block w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-900"
            />
            {files.length > 0 && (
              <div className="rounded-xl bg-slate-950 p-4 text-sm text-slate-300">
                <div className="mb-2 font-medium text-slate-100">已选择 {files.length} 个文件</div>
                <ul className="list-inside list-disc space-y-1">
                  {files.map((file) => (
                    <li key={`${file.name}-${file.size}`}>{file.name}</li>
                  ))}
                </ul>
              </div>
            )}
            <button
              onClick={handleSubmit}
              disabled={status === "uploading" || status === "running" || status === "submitted"}
              className="rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              开始审稿
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">实时进度</h2>
              <p className="text-sm text-slate-400">{message}</p>
              {jobId && <p className="mt-1 text-xs text-slate-500">Job ID: {jobId}</p>}
            </div>
            <div className="text-right text-sm text-slate-300">{progress}%</div>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          {error && <div className="mt-4 rounded-xl border border-red-800 bg-red-950/60 p-4 text-sm text-red-200">{error}</div>}

          {jobState?.papers?.length ? (
            <div className="mt-6 space-y-3">
              {jobState.papers.map((paper) => (
                <div key={paper.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="font-medium text-slate-100">{paper.file_name}</div>
                    <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">{statusText(paper.status)}</span>
                  </div>
                  <div className="mt-2 text-sm text-slate-400">{paper.message || ""}</div>
                  {paper.error && <div className="mt-2 text-sm text-red-300">{paper.error}</div>}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        {jobState?.job?.final_result && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h2 className="mb-4 text-xl font-semibold">最终审稿意见</h2>
            <pre className="whitespace-pre-wrap rounded-xl bg-slate-950 p-5 text-sm leading-7 text-slate-100">
              {jobState.job.final_result}
            </pre>
          </section>
        )}
      </div>
    </main>
  );
}

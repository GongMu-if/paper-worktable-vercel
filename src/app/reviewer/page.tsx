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

function statusBadgeClass(status?: string | null) {
  const value = String(status || "");
  if (value === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "completed_with_errors") return "border-amber-200 bg-amber-50 text-amber-700";
  if (value === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (value === "processing") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
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

export default function ReviewerPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<UiStatus>("idle");
  const [message, setMessage] = useState("请选择需要审稿的 PDF 文件。支持批量上传。");
  const [jobId, setJobId] = useState<string>("");
  const [jobState, setJobState] = useState<ReviewJobStatus | null>(null);
  const [error, setError] = useState<string>("");
  const pollingRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isBusy = status === "uploading" || status === "running" || status === "submitted";

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

  function addFiles(selected: File[]) {
    const pdfs = selected.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    setFiles((prev) => {
      const next = [...prev];
      for (const file of pdfs) {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        if (!next.some((item) => `${item.name}-${item.size}-${item.lastModified}` === key)) {
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
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#dbeafe_0,#eef6ff_28%,#f8fbff_54%,#eef6ff_100%)] px-4 py-8 text-slate-950 sm:px-6 lg:px-10">
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-70">
        <div className="absolute left-[-12rem] top-[-10rem] h-96 w-96 rounded-full bg-blue-200 blur-3xl" />
        <div className="absolute right-[-10rem] top-24 h-96 w-96 rounded-full bg-cyan-100 blur-3xl" />
        <div className="absolute bottom-[-12rem] left-1/3 h-96 w-96 rounded-full bg-indigo-100 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl space-y-7">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/75 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.10)] backdrop-blur-xl lg:p-10">
          <div className="absolute right-0 top-0 h-full w-1/3 rounded-l-[5rem] bg-gradient-to-br from-blue-100/80 to-sky-50/30" />
          <div className="relative grid gap-8 lg:grid-cols-[1fr_320px] lg:items-center">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-blue-600" />
                Journal of Control and Decision 审稿辅助
              </div>
              <div>
                <h1 className="max-w-4xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                  批量论文审稿 Agent
                </h1>
                <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
                  上传多篇 PDF 后，系统并行解析文本，判断是否符合期刊收录方向，并输出三段式审稿意见：整体评价、中文评语、英文学术翻译。
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {[
                ["1", "批量上传", "多篇 PDF 上传至 Supabase Storage"],
                ["2", "并行审稿", "Modal 后端并行解析文本与生成意见"],
                ["3", "三段输出", "整体评价、中文评语、英文翻译"],
              ].map(([num, title, desc]) => (
                <div key={num} className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-[0_12px_40px_rgba(15,23,42,0.08)] backdrop-blur">
                  <div className="flex gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-sm font-bold text-white">
                      {num}
                    </div>
                    <div>
                      <div className="font-bold text-slate-950">{title}</div>
                      <div className="mt-1 text-sm leading-5 text-slate-500">{desc}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="grid gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <section className="rounded-[1.7rem] border border-white/70 bg-white/85 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl lg:p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black tracking-tight text-slate-950">步骤 1 · 上传待审论文</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  支持批量上传 PDF。前端只显示实时进度，最终汇总每篇论文的审稿意见。
                </p>
              </div>
              <div className="hidden rounded-2xl bg-slate-950 px-4 py-3 text-right text-white sm:block">
                <div className="text-xs text-slate-300">已选择</div>
                <div className="text-2xl font-black">{files.length}</div>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(event) => addFiles(Array.from(event.target.files || []))}
              className="hidden"
            />

            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                addFiles(Array.from(event.dataTransfer.files || []));
              }}
              className="group cursor-pointer rounded-[1.5rem] border border-dashed border-blue-300 bg-gradient-to-br from-blue-50/80 to-white p-8 text-center transition hover:border-blue-500 hover:bg-blue-50"
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-2xl text-white shadow-lg shadow-blue-200 transition group-hover:scale-105">
                ↑
              </div>
              <div className="mt-4 text-lg font-black text-slate-950">点击选择 PDF，或拖拽文件到这里</div>
              <div className="mt-2 text-sm text-slate-500">仅接收 PDF 文件，可一次上传多篇论文。</div>
              <button
                type="button"
                className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-slate-200 transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                选择 PDF 文件
              </button>
            </div>

            {files.length > 0 && (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-bold text-slate-950">待审稿文件</div>
                  <button
                    type="button"
                    onClick={() => setFiles([])}
                    disabled={isBusy}
                    className="text-sm font-semibold text-slate-400 transition hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    清空
                  </button>
                </div>
                <div className="space-y-2">
                  {files.map((file, index) => (
                    <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-slate-800">{file.name}</div>
                        <div className="mt-1 text-xs text-slate-400">{formatFileSize(file.size)}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        disabled={isBusy}
                        className="shrink-0 rounded-lg px-3 py-1 text-sm font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={isBusy || !files.length}
              className="mt-6 w-full rounded-2xl bg-blue-600 px-6 py-4 text-base font-black text-white shadow-[0_18px_40px_rgba(37,99,235,0.25)] transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {isBusy ? "任务处理中..." : "开始批量审稿"}
            </button>
          </section>

          <aside className="space-y-7">
            <section className="rounded-[1.7rem] border border-white/70 bg-white/85 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl lg:p-7">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-950">实时进度</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{message}</p>
                </div>
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-lg font-black text-white">
                  {progress}%
                </div>
              </div>

              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-xl font-black text-slate-950">{paperCount}</div>
                  <div className="mt-1 text-xs text-slate-400">总论文</div>
                </div>
                <div className="rounded-2xl bg-emerald-50 p-3">
                  <div className="text-xl font-black text-emerald-700">{completedCount}</div>
                  <div className="mt-1 text-xs text-emerald-600/70">已完成</div>
                </div>
                <div className="rounded-2xl bg-rose-50 p-3">
                  <div className="text-xl font-black text-rose-700">{failedCount}</div>
                  <div className="mt-1 text-xs text-rose-600/70">失败</div>
                </div>
              </div>

              {jobId && <div className="mt-4 truncate rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-400">Job ID: {jobId}</div>}
            </section>

            <section className="rounded-[1.7rem] border border-white/70 bg-white/85 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl lg:p-7">
              <h2 className="text-2xl font-black tracking-tight text-slate-950">处理队列</h2>
              <p className="mt-2 text-sm text-slate-500">每篇论文独立并行处理，完成后自动汇总结果。</p>

              {jobState?.papers?.length ? (
                <div className="mt-5 space-y-3">
                  {jobState.papers.map((paper) => (
                    <div key={paper.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-slate-900">{paper.file_name}</div>
                          <div className="mt-1 text-xs leading-5 text-slate-400">{paper.message || "等待后端返回状态"}</div>
                        </div>
                        <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${statusBadgeClass(paper.status)}`}>
                          {statusText(paper.status)}
                        </span>
                      </div>
                      {paper.error && <div className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{paper.error}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                  暂无审稿任务。
                </div>
              )}
            </section>
          </aside>
        </div>

        {jobState?.job?.final_result && (
          <section className="rounded-[1.7rem] border border-white/70 bg-white/90 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl lg:p-7">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black tracking-tight text-slate-950">最终审稿意见</h2>
                <p className="mt-2 text-sm text-slate-500">按照论文顺序汇总展示，可直接复制用于进一步整理。</p>
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(jobState.job.final_result || "")}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                复制结果
              </button>
            </div>
            <pre className="max-h-[680px] overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-100 bg-slate-950 p-6 text-sm leading-7 text-slate-100 shadow-inner">
              {jobState.job.final_result}
            </pre>
          </section>
        )}
      </div>
    </main>
  );
}

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

export default function IntroductionWriterPage() {
  const [userId, setUserId] = useState("");
  const [innovationText, setInnovationText] = useState("");
  const [mainFile, setMainFile] = useState<File | null>(null);

  const [supportFile1, setSupportFile1] = useState<File | null>(null);
  const [supportFile2, setSupportFile2] = useState<File | null>(null);

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
      setMessage("Please upload the main reference paper PDF.");
      return;
    }

    if (!innovationText.trim()) {
      setMessage("Please enter your innovation points.");
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
        setMessage(
          "Main reference paper submitted. The system is analyzing it."
        );
        await refreshHistory(userId);
      } else {
        setMessage(result?.message || "Submit succeeded but no job_id returned.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitSupporting() {
    if (!jobId) {
      setMessage("Missing job_id.");
      return;
    }

    if (!supportFile1 || !supportFile2) {
      setMessage("Please upload two supporting same-problem papers.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      await submitSupportingPapers({
        jobId,
        file1: supportFile1,
        file2: supportFile2,
      });

      setMessage(
        "Supporting papers submitted. The system is generating the English Introduction."
      );
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
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">English Introduction Writer</h1>
        <p className="mt-2 text-sm text-gray-600">
          Upload one main reference paper and your innovation points. After the
          system recommends same-problem papers, upload two supporting papers to
          generate an English Introduction.
        </p>
      </div>

      {message && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          {message}
        </div>
      )}

      <section className="mb-8 rounded-xl border border-gray-200 p-5">
        <h2 className="mb-4 text-xl font-semibold">
          Step 1: Main reference paper and innovation points
        </h2>

        <label className="mb-2 block text-sm font-medium">
          Innovation points
        </label>
        <textarea
          value={innovationText}
          onChange={(event) => setInnovationText(event.target.value)}
          className="mb-4 h-52 w-full rounded-lg border border-gray-300 p-3 text-sm outline-none"
          placeholder={
            "Describe your research problem, target task, method idea, and 2–4 innovation points. The generated Introduction will be English only."
          }
        />

        <label className="mb-2 block text-sm font-medium">
          Main reference paper PDF
        </label>
        <input
          type="file"
          accept="application/pdf"
          onChange={(event) => setMainFile(event.target.files?.[0] || null)}
          className="mb-4 block w-full text-sm"
        />

        <button
          onClick={handleSubmitReference}
          disabled={loading}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Submitting..." : "Analyze main reference paper"}
        </button>
      </section>

      {jobId && (
        <section className="mb-8 rounded-xl border border-gray-200 p-5">
          <h2 className="mb-4 text-xl font-semibold">Current job</h2>

          <div className="mb-4 text-sm">
            <div>
              <span className="font-medium">Job ID:</span> {jobId}
            </div>
            <div>
              <span className="font-medium">Status:</span>{" "}
              {status || "loading"}
            </div>
            <div>
              <span className="font-medium">Stage:</span> {stage || "-"}
            </div>
            {job?.progress_text && (
              <div className="mt-2 rounded-lg bg-gray-50 p-3">
                {job.progress_text}
              </div>
            )}
            {job?.error_text && (
              <div className="mt-2 rounded-lg bg-red-50 p-3 text-red-700">
                {job.error_text}
              </div>
            )}
          </div>

          <button
            onClick={() => refreshJob(jobId)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            Refresh
          </button>
        </section>
      )}

      {job?.status === "awaiting_supporting_papers" && (
        <section className="mb-8 rounded-xl border border-gray-200 p-5">
          <h2 className="mb-4 text-xl font-semibold">
            Step 2: Upload two same-problem supporting papers
          </h2>

          <div className="mb-6">
            <h3 className="mb-3 text-lg font-semibold">
              Same-problem candidate papers
            </h3>

            {Array.isArray(job.same_problem_candidates) &&
            job.same_problem_candidates.length > 0 ? (
              <div className="space-y-3">
                {job.same_problem_candidates
                  .slice(0, 10)
                  .map((item: any, index: number) => (
                    <div
                      key={`${item?.title || "candidate"}-${index}`}
                      className="rounded-lg border border-gray-200 p-4 text-sm"
                    >
                      <div className="font-semibold">
                        {index + 1}. {item?.title || "Untitled"}
                      </div>
                      <div className="mt-1 text-gray-600">
                        Year: {item?.year || "-"} | Relation:{" "}
                        {item?.relation || "-"} | Confidence:{" "}
                        {item?.confidence ?? "-"}
                      </div>
                      {item?.reason && <div className="mt-2">{item.reason}</div>}
                      {item?.url && (
                        <div className="mt-2 break-all text-blue-600">
                          {item.url}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            ) : (
              <div className="rounded-lg bg-gray-50 p-4 text-sm">
                No candidate papers found. You can still upload two supporting
                papers manually.
              </div>
            )}
          </div>

          <label className="mb-2 block text-sm font-medium">
            Supporting paper 1 PDF
          </label>
          <input
            type="file"
            accept="application/pdf"
            onChange={(event) => setSupportFile1(event.target.files?.[0] || null)}
            className="mb-4 block w-full text-sm"
          />

          <label className="mb-2 block text-sm font-medium">
            Supporting paper 2 PDF
          </label>
          <input
            type="file"
            accept="application/pdf"
            onChange={(event) => setSupportFile2(event.target.files?.[0] || null)}
            className="mb-4 block w-full text-sm"
          />

          <button
            onClick={handleSubmitSupporting}
            disabled={loading}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Submitting..." : "Generate English Introduction"}
          </button>
        </section>
      )}

      {job?.status === "finished" && (
        <section className="mb-8 rounded-xl border border-gray-200 p-5">
          <h2 className="mb-4 text-xl font-semibold">
            Final English Introduction
          </h2>

          <div className="mb-4 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-5 text-sm leading-7">
            {job.final_introduction || "No introduction returned."}
          </div>

          <button
            onClick={downloadIntroduction}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            Download Markdown
          </button>

          <details className="mt-6 rounded-lg border border-gray-200 p-4">
            <summary className="cursor-pointer font-medium">
              Final references / citation pool
            </summary>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">
              {formatJson(job.final_references || job.citation_pool || [])}
            </pre>
          </details>

          <details className="mt-4 rounded-lg border border-gray-200 p-4">
            <summary className="cursor-pointer font-medium">
              Reviewer history
            </summary>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">
              {formatJson(job.review_history || [])}
            </pre>
          </details>

          <details className="mt-4 rounded-lg border border-gray-200 p-4">
            <summary className="cursor-pointer font-medium">
              Field knowledge
            </summary>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">
              {formatJson(job.field_knowledge || {})}
            </pre>
          </details>
        </section>
      )}

      {jobId && (
        <section className="mb-8 rounded-xl border border-gray-200 p-5">
          <h2 className="mb-4 text-xl font-semibold">Execution logs</h2>

          {logs.length > 0 ? (
            <div className="space-y-2 text-sm">
              {logs.map((log, index) => (
                <div key={index} className="rounded-lg bg-gray-50 p-3">
                  <span className="font-medium">
                    [{log?.step_no ?? index + 1}]
                  </span>{" "}
                  {log?.stage || "-"} - {log?.status || "-"}:{" "}
                  {log?.message || ""}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500">No logs loaded.</div>
          )}
        </section>
      )}

      <section className="rounded-xl border border-gray-200 p-5">
        <h2 className="mb-4 text-xl font-semibold">Introduction history</h2>

        {history.length > 0 ? (
          <div className="space-y-2">
            {history.map((item: any) => (
              <button
                key={item.id}
                onClick={() => setJobId(item.id)}
                className="block w-full rounded-lg border border-gray-200 p-3 text-left text-sm hover:bg-gray-50"
              >
                <div className="font-medium">
                  {item.main_pdf_name || "Untitled"}
                </div>
                <div className="text-gray-600">
                  {item.status || "-"} | {item.stage || "-"} |{" "}
                  {item.created_at || ""}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">
            No introduction jobs found.
          </div>
        )}
      </section>
    </main>
  );
}

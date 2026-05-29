export type IntroJob = {
  id?: string;
  user_id?: string;

  status?: string;
  stage?: string;
  progress_text?: string;
  error_text?: string;

  innovation_text?: string;
  main_pdf_name?: string;

  reference_analysis?: any;
  same_problem_candidates?: any[];

  supporting_paper_analysis?: any[];
  field_knowledge?: any;
  citation_plan?: any;
  citation_pool?: any[];

  final_introduction?: string;
  final_references?: any[];
  review_history?: any[];

  created_at?: string;
  updated_at?: string;
};

function getDirectReferenceUploadUrl() {
  return process.env.NEXT_PUBLIC_INTRO_SUBMIT_REFERENCE_URL || "";
}

function getDirectSupportingUploadUrl() {
  return process.env.NEXT_PUBLIC_INTRO_SUBMIT_SUPPORTING_URL || "";
}

export async function introRpc(
  action: string,
  payload: Record<string, any> = {}
) {
  const resp = await fetch("/api/introduction/rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({ action, payload }),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    throw new Error(data?.message || `Introduction RPC failed: ${resp.status}`);
  }

  return data;
}

export async function getIntroJob(jobId: string): Promise<IntroJob> {
  const result = await introRpc("get_job", { job_id: jobId });

  if (result?.status !== "ok") {
    throw new Error(result?.message || "Failed to load introduction job.");
  }

  return result?.data || {};
}

export async function getIntroLogs(jobId: string): Promise<any[]> {
  const result = await introRpc("get_logs", { job_id: jobId });

  if (result?.status !== "ok") {
    return [];
  }

  return result?.data || [];
}

export async function listIntroJobs(
  userId: string,
  limit = 20
): Promise<IntroJob[]> {
  const result = await introRpc("list_jobs", {
    user_id: userId,
    limit,
  });

  if (result?.status !== "ok") {
    return [];
  }

  return result?.data || [];
}

export async function submitReferencePaper(params: {
  userId: string;
  innovationText: string;
  sourceName: string;
  file: File;
}) {
  const formData = new FormData();
  formData.append("user_id", params.userId || "");
  formData.append("innovation_text", params.innovationText || "");
  formData.append("source_name", params.sourceName || params.file.name);
  formData.append("file", params.file, params.file.name);

  // Large PDF upload must bypass Vercel API Route because Vercel Functions have a 4.5 MB payload limit.
  // If NEXT_PUBLIC_INTRO_SUBMIT_REFERENCE_URL is configured, upload directly to Modal.
  const directUrl = getDirectReferenceUploadUrl();
  const uploadUrl = directUrl || "/api/introduction/reference";

  const resp = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    throw new Error(
      data?.message || `Submit reference paper failed: ${resp.status}`
    );
  }

  return data;
}

export async function submitSupportingPapers(params: {
  jobId: string;
  file1: File;
  file2: File;
  supportName1?: string;
  supportName2?: string;
}) {
  const formData = new FormData();
  formData.append("job_id", params.jobId);
  formData.append("support_name_1", params.supportName1 || params.file1.name);
  formData.append("support_name_2", params.supportName2 || params.file2.name);
  formData.append("file1", params.file1, params.file1.name);
  formData.append("file2", params.file2, params.file2.name);

  // Large PDF upload must bypass Vercel API Route because Vercel Functions have a 4.5 MB payload limit.
  // If NEXT_PUBLIC_INTRO_SUBMIT_SUPPORTING_URL is configured, upload directly to Modal.
  const directUrl = getDirectSupportingUploadUrl();
  const uploadUrl = directUrl || "/api/introduction/supporting";

  const resp = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    throw new Error(
      data?.message || `Submit supporting papers failed: ${resp.status}`
    );
  }

  return data;
}

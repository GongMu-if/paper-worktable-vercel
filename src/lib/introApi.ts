import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

let supabaseBrowserClient: SupabaseClient | null = null;

function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!url || !anonKey) {
    throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY。");
  }

  if (!supabaseBrowserClient) {
    supabaseBrowserClient = createClient(url, anonKey);
  }

  return supabaseBrowserClient;
}

function getStorageBucket() {
  return process.env.NEXT_PUBLIC_INTRO_STORAGE_BUCKET || "intro-pdfs";
}

function sanitizeFileName(name: string) {
  const cleaned = (name || "paper.pdf")
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);

  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

function createStoragePath(file: File, role: "main" | "support") {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${role}/${new Date().toISOString().slice(0, 10)}/${random}-${sanitizeFileName(file.name)}`;
}

async function createSignedUpload(path: string, contentType = "application/pdf") {
  const resp = await fetch("/api/introduction/storage/sign-upload", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      bucket: getStorageBucket(),
      path,
      content_type: contentType,
    }),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok || data?.status !== "ok") {
    throw new Error(data?.message || `创建上传签名失败：${resp.status}`);
  }

  return data.data as { path: string; token: string; signedUrl?: string };
}

async function createSignedDownload(path: string) {
  const resp = await fetch("/api/introduction/storage/sign-download", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      bucket: getStorageBucket(),
      path,
      expires_in: 60 * 60 * 24,
    }),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok || data?.status !== "ok") {
    throw new Error(data?.message || `创建下载签名失败：${resp.status}`);
  }

  return data.data as { path: string; signedUrl: string };
}

async function uploadPdfToStorage(file: File, role: "main" | "support") {
  const supabase = getSupabaseBrowserClient();
  const path = createStoragePath(file, role);

  const uploadSign = await createSignedUpload(path, file.type || "application/pdf");

  const { error: uploadError } = await supabase.storage
    .from(getStorageBucket())
    .uploadToSignedUrl(uploadSign.path || path, uploadSign.token, file, {
      contentType: file.type || "application/pdf",
    });

  if (uploadError) {
    throw new Error(`PDF 上传到对象存储失败：${uploadError.message}`);
  }

  const downloadSign = await createSignedDownload(uploadSign.path || path);

  return {
    path: uploadSign.path || path,
    signedUrl: downloadSign.signedUrl,
  };
}

async function postForm(url: string, formData: FormData) {
  const resp = await fetch(url, {
    method: "POST",
    body: formData,
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    throw new Error(data?.message || `请求失败：${resp.status}`);
  }

  return data;
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
    throw new Error(data?.message || `Introduction RPC 请求失败: ${resp.status}`);
  }

  return data;
}

export async function getIntroJob(jobId: string): Promise<IntroJob> {
  const result = await introRpc("get_job", { job_id: jobId });

  if (result?.status !== "ok") {
    throw new Error(result?.message || "无法读取 Introduction 任务。");
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
  const uploaded = await uploadPdfToStorage(params.file, "main");

  const formData = new FormData();
  formData.append("user_id", params.userId || "");
  formData.append("innovation_text", params.innovationText || "");
  formData.append("source_name", params.sourceName || params.file.name);
  formData.append("file_url", uploaded.signedUrl);
  formData.append("storage_path", uploaded.path);

  return postForm("/api/introduction/reference-url", formData);
}

export async function submitSupportingPapers(params: {
  jobId: string;
  files?: File[];
  file1?: File;
  file2?: File;
  supportName1?: string;
  supportName2?: string;
}) {
  const files = params.files && params.files.length > 0
    ? params.files
    : [params.file1, params.file2].filter((file): file is File => Boolean(file));

  if (files.length < 2 || files.length > 6) {
    throw new Error(`请上传 2-6 篇补充论文。当前数量：${files.length}`);
  }

  const uploaded = await Promise.all(
    files.map(async (file) => {
      const item = await uploadPdfToStorage(file, "support");
      return {
        name: file.name,
        file_url: item.signedUrl,
        storage_path: item.path,
      };
    })
  );

  const formData = new FormData();
  formData.append("job_id", params.jobId);
  formData.append("supporting_files", JSON.stringify(uploaded));

  // 兼容旧的两文件代理字段；新后端优先读取 supporting_files。
  formData.append("support_name_1", params.supportName1 || uploaded[0]?.name || files[0]?.name || "");
  formData.append("support_name_2", params.supportName2 || uploaded[1]?.name || files[1]?.name || "");
  formData.append("file_url_1", uploaded[0]?.file_url || "");
  formData.append("file_url_2", uploaded[1]?.file_url || "");
  formData.append("storage_path_1", uploaded[0]?.storage_path || "");
  formData.append("storage_path_2", uploaded[1]?.storage_path || "");

  return postForm("/api/introduction/supporting-urls", formData);
}

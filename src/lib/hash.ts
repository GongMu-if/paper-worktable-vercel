export async function getPdfCacheKey(file: File, analysisCacheVersion: string): Promise<string> {
  const prefix = new TextEncoder().encode(analysisCacheVersion || "");
  const pdfBytes = new Uint8Array(await file.arrayBuffer());
  const combined = new Uint8Array(prefix.length + pdfBytes.length);
  combined.set(prefix, 0);
  combined.set(pdfBytes, prefix.length);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function buildExportFilename(sourceName: string, suffix: string): string {
  const baseName = (sourceName || "论文")
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim() || "论文";
  return `${baseName}${suffix}`;
}

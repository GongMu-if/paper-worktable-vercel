"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { normalizeReportMarkdown } from "@/lib/api";

type ImageValue =
  | string
  | {
      data?: string;
      base64?: string;
      b64?: string;
      content?: string;
      image_base64?: string;
      imageData?: string;
      mime?: string;
      mime_type?: string;
      content_type?: string;
      filename?: string;
      name?: string;
      path?: string;
      src?: string;
      url?: string;
    };

type Props = {
  markdown: string;
  images?: Record<string, ImageValue>;
  normalize?: boolean;
};

function normalizeImageKey(value: string | undefined): string {
  return decodeURIComponent(value || "")
    .trim()
    .replace(/^\.?\//, "")
    .replace(/^images\//, "")
    .replace(/^figures\//, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function inferMimeFromName(name: string | undefined): string {
  const value = (name || "").toLowerCase();

  if (value.endsWith(".jpg") || value.endsWith(".jpeg")) return "image/jpeg";
  if (value.endsWith(".webp")) return "image/webp";
  if (value.endsWith(".gif")) return "image/gif";
  if (value.endsWith(".svg")) return "image/svg+xml";

  return "image/png";
}

function imageValueToSrc(value: ImageValue | undefined, fallbackName?: string): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;

    if (
      text.startsWith("data:") ||
      text.startsWith("http://") ||
      text.startsWith("https://") ||
      text.startsWith("/") ||
      text.startsWith("blob:")
    ) {
      return text;
    }

    return `data:${inferMimeFromName(fallbackName)};base64,${text}`;
  }

  const direct = value.url || value.src || value.path;
  if (
    direct &&
    (direct.startsWith("data:") ||
      direct.startsWith("http://") ||
      direct.startsWith("https://") ||
      direct.startsWith("/") ||
      direct.startsWith("blob:"))
  ) {
    return direct;
  }

  const raw =
    value.data ||
    value.base64 ||
    value.b64 ||
    value.content ||
    value.image_base64 ||
    value.imageData;

  if (!raw) return null;
  if (raw.startsWith("data:")) return raw;

  const mime =
    value.mime ||
    value.mime_type ||
    value.content_type ||
    inferMimeFromName(value.filename || value.name || fallbackName);

  return `data:${mime};base64,${raw}`;
}

function findImageSrc(
  src: string | undefined,
  alt: string | undefined,
  images: Record<string, ImageValue>
): string | null {
  const candidates = [src, alt]
    .map(normalizeImageKey)
    .filter(Boolean);

  for (const candidate of candidates) {
    for (const [name, value] of Object.entries(images || {})) {
      const key = normalizeImageKey(name);

      const valueName =
        typeof value === "object"
          ? normalizeImageKey(value.filename || value.name || value.path || value.src || value.url)
          : "";

      const matched =
        candidate === key ||
        key.endsWith(candidate) ||
        candidate.endsWith(key) ||
        (!!valueName &&
          (candidate === valueName ||
            valueName.endsWith(candidate) ||
            candidate.endsWith(valueName)));

      if (matched) {
        return imageValueToSrc(value, src || alt || name);
      }
    }
  }

  return null;
}

function protectCodeBlocks(value: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];

  let text = (value || "").replace(/```[\s\S]*?```/g, (match) => {
    const key = `@@CODE_BLOCK_${blocks.length}@@`;
    blocks.push(match);
    return key;
  });

  text = text.replace(/`[^`\n]+`/g, (match) => {
    const key = `@@CODE_BLOCK_${blocks.length}@@`;
    blocks.push(match);
    return key;
  });

  return { text, blocks };
}

function restoreCodeBlocks(value: string, blocks: string[]): string {
  let result = value || "";

  blocks.forEach((block, index) => {
    result = result.replace(`@@CODE_BLOCK_${index}@@`, block);
  });

  return result;
}

function repairLatexExpression(expr: string): string {
  return (expr || "")
    .trim()
    // 修复模型常见错误：\fracTP{TP + FN} -> \frac{TP}{TP + FN}
    .replace(/\\frac\s*([A-Za-z0-9]+)\s*\{/g, "\\frac{$1}{")
    // 修复 \fracTP TP 这种极端情况
    .replace(/\\frac\s*([A-Za-z0-9]+)\s+([A-Za-z0-9]+)/g, "\\frac{$1}{$2}");
}

function looksLikeStandaloneLatex(line: string): boolean {
  const value = line.trim();

  if (!value) return false;
  if (value.startsWith("#")) return false;
  if (value.startsWith("|")) return false;
  if (/^[-*+]\s+/.test(value)) return false;
  if (/^\d+[.)、]\s+/.test(value)) return false;
  if (value.startsWith(">")) return false;
  if (value.includes("$")) return false;

  return /\\(frac|mathrm|text|sum|prod|sqrt|alpha|beta|gamma|delta|lambda|mu|sigma|cdot|times|leq|geq|infty)\b/.test(value);
}

function repairReportMarkdown(value: string): string {
  const { text, blocks } = protectCodeBlocks(value || "");

  let repaired = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\\$/g, "$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$")
    .replace(/\\\[/g, "\n\n$$\n")
    .replace(/\\\]/g, "\n$$\n\n");

  const lines = repaired.split("\n");
  const output: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 很多报告会出现：\mathrm{F1...}=... $$ 其中，
    // 这里把 $$ 前面的裸公式包成 display math，把后面的中文恢复成正文。
    if (looksLikeStandaloneLatex(trimmed) && trimmed.includes("$$")) {
      const [formulaPart, ...restParts] = trimmed.split("$$");
      const restText = restParts.join("$$").trim();

      output.push("");
      output.push("$$");
      output.push(repairLatexExpression(formulaPart));
      output.push("$$");
      output.push("");

      if (restText) output.push(restText);
      continue;
    }

    if (looksLikeStandaloneLatex(trimmed)) {
      output.push("");
      output.push("$$");
      output.push(repairLatexExpression(trimmed));
      output.push("$$");
      output.push("");
      continue;
    }

    // 避免普通正文被 4 空格缩进误识别为代码块。
    if (/^( {4,}|\t)([\u4e00-\u9fa5A-Za-z0-9（(【\[])/.test(line)) {
      output.push(line.replace(/^( {4,}|\t)+/, ""));
      continue;
    }

    output.push(line);
  }

  repaired = output.join("\n");

  // 修复 display math 的空白格式。
  repaired = repaired
    .replace(/\$\$\s*([^\n$][\s\S]*?)\s*\$\$/g, (_, expr: string) => {
      return `\n\n$$\n${repairLatexExpression(expr)}\n$$\n\n`;
    })
    .replace(/\n{3,}/g, "\n\n");

  return restoreCodeBlocks(repaired, blocks);
}

export function MarkdownReport({ markdown, images = {}, normalize = false }: Props) {
  const [normalizedMarkdown, setNormalizedMarkdown] = useState(markdown || "");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!normalize) {
        setNormalizedMarkdown(markdown || "");
        return;
      }

      try {
        const normalized = await normalizeReportMarkdown(markdown || "");
        if (!cancelled) {
          setNormalizedMarkdown(normalized || markdown || "");
        }
      } catch {
        if (!cancelled) {
          setNormalizedMarkdown(markdown || "");
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [markdown, normalize]);

  const displayMarkdown = useMemo(
    () => repairReportMarkdown(normalizedMarkdown || ""),
    [normalizedMarkdown]
  );

  const components = useMemo(
    () => ({
      img: ({ src, alt }: { src?: string; alt?: string }) => {
        const resolvedSrc = findImageSrc(src, alt, images);
        const directSrc = src || "";

        const finalSrc =
          resolvedSrc ||
          (directSrc.startsWith("data:") ||
          directSrc.startsWith("http://") ||
          directSrc.startsWith("https://") ||
          directSrc.startsWith("/") ||
          directSrc.startsWith("blob:")
            ? directSrc
            : "");

        if (!finalSrc) {
          return (
            <figure className="figure figure-missing">
              <div className="image-missing">
                图片未找到：{alt || src || "未命名图片"}
              </div>
            </figure>
          );
        }

        return (
          <figure className="figure">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={finalSrc} alt={alt || "report image"} loading="lazy" />
            {alt ? <figcaption>{alt}</figcaption> : null}
          </figure>
        );
      },
    }),
    [images]
  );

  return (
    <div className="report-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={components as never}
        skipHtml={false}
      >
        {displayMarkdown || "暂无内容。"}
      </ReactMarkdown>
    </div>
  );
}

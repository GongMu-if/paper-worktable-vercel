"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import katex from "katex";
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

function escapeHtml(value: string): string {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeImageKey(value: string | undefined): string {
  return safeDecodeURIComponent(value || "")
    .trim()
    .replace(/^\.?\//, "")
    .replace(/^images\//, "")
    .replace(/^figures\//, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizeBase64(value: string): string {
  return (value || "").replace(/\s+/g, "");
}

function looksLikeBase64Image(value: string): boolean {
  const text = normalizeBase64(value || "");

  if (!text) return false;
  if (text.startsWith("data:image/")) return true;
  if (text.startsWith("iVBORw0KGgo")) return true; // PNG
  if (text.startsWith("/9j/")) return true; // JPEG
  if (text.startsWith("R0lGOD")) return true; // GIF
  if (text.startsWith("UklGR")) return true; // WEBP
  if (text.startsWith("PHN2Zy")) return true; // SVG base64

  return text.length > 500 && /^[A-Za-z0-9+/=]+$/.test(text);
}

function inferMimeFromBase64OrName(value: string, name?: string): string {
  const text = normalizeBase64(value || "");
  const lowerName = (name || "").toLowerCase();

  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
  if (lowerName.endsWith(".webp")) return "image/webp";
  if (lowerName.endsWith(".gif")) return "image/gif";
  if (lowerName.endsWith(".svg")) return "image/svg+xml";

  if (text.startsWith("/9j/")) return "image/jpeg";
  if (text.startsWith("R0lGOD")) return "image/gif";
  if (text.startsWith("UklGR")) return "image/webp";
  if (text.startsWith("PHN2Zy")) return "image/svg+xml";

  return "image/png";
}

function toImageSrc(value: unknown, fallbackName?: string): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;

    if (text.startsWith("data:image/")) return text;
    if (text.startsWith("http://") || text.startsWith("https://") || text.startsWith("blob:")) {
      return text;
    }

    // JPEG base64 常以 /9j/ 开头，所以必须先判断 base64，再判断 "/"。
    if (looksLikeBase64Image(text)) {
      const clean = normalizeBase64(text);
      const mime = inferMimeFromBase64OrName(clean, fallbackName);
      return `data:${mime};base64,${clean}`;
    }

    if (text.startsWith("/")) return text;

    return null;
  }

  if (typeof value === "object") {
    const item = value as {
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

    const objectName = item.filename || item.name || fallbackName;

    const direct = item.url || item.src || item.path;
    if (direct) {
      const directSrc = toImageSrc(direct, objectName);
      if (directSrc) return directSrc;
    }

    const raw =
      item.data ||
      item.base64 ||
      item.b64 ||
      item.content ||
      item.image_base64 ||
      item.imageData;

    if (!raw) return null;
    if (raw.startsWith("data:image/")) return raw;

    const clean = normalizeBase64(raw);
    const mime =
      item.mime ||
      item.mime_type ||
      item.content_type ||
      inferMimeFromBase64OrName(clean, objectName);

    return `data:${mime};base64,${clean}`;
  }

  return null;
}

function findImageSrc(
  src: string | undefined,
  alt: string | undefined,
  images: Record<string, ImageValue>
): string | null {
  const srcAsImage = toImageSrc(src, alt || src);
  if (srcAsImage) return srcAsImage;

  const candidates = [src, alt].map(normalizeImageKey).filter(Boolean);

  for (const candidate of candidates) {
    for (const [name, value] of Object.entries(images || {})) {
      const key = normalizeImageKey(name);

      const valueName =
        typeof value === "object" && value
          ? normalizeImageKey(
              value.filename ||
                value.name ||
                value.path ||
                value.src ||
                value.url
            )
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
        return toImageSrc(value, src || alt || name);
      }
    }
  }

  return null;
}

function repairLatexExpression(expr: string): string {
  let value = (expr || "").trim();

  value = value
    // \fracTP{TP + FN} -> \frac{TP}{TP + FN}
    .replace(/\\frac\s*([A-Za-z0-9]+)\s*\{/g, "\\frac{$1}{")
    // \fracTP TP -> \frac{TP}{TP}
    .replace(/\\frac\s*([A-Za-z0-9]+)\s+([A-Za-z0-9]+)/g, "\\frac{$1}{$2}")
    .replace(/\\mathrm\{F1\\text\{-\}score\}/g, "\\mathrm{F1\\text{-}score}");

  // 把常见的多字符下标补成 {...}
  // C_TC -> C_{TC}, \mu_TC -> \mu_{TC}
  value = value.replace(/(\\[A-Za-z]+)_([A-Za-z]{2,})(?=[\s,;:+\-*/=)\]}]|$)/g, "$1_{$2}");
  value = value.replace(/([A-Za-z])_([A-Za-z]{2,})(?=[\s,;:+\-*/=)\]}]|$)/g, "$1_{$2}");

  return value;
}

function renderKatex(tex: string, displayMode: boolean): string {
  const cleaned = repairLatexExpression(tex || "");
  if (!cleaned) return "";

  try {
    return katex.renderToString(cleaned, {
      displayMode,
      throwOnError: true,
      strict: false,
      trust: false,
    });
  } catch {
    // 不显示红色报错，不把中文吞进去；渲染失败时只显示普通等宽文本。
    const className = displayMode ? "math-fallback math-fallback-display" : "math-fallback";
    return `<span class="${className}">${escapeHtml(cleaned)}</span>`;
  }
}

function protectBlocks(value: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];

  let text = (value || "").replace(/```[\s\S]*?```/g, (match) => {
    const key = `@@PROTECTED_BLOCK_${blocks.length}@@`;
    blocks.push(match);
    return key;
  });

  // 保护图片语法，避免图片 alt 中的 $...$ 被正文公式预处理破坏。
  text = text.replace(/!\[[\s\S]*?]\([^)]+\)/g, (match) => {
    const key = `@@PROTECTED_BLOCK_${blocks.length}@@`;
    blocks.push(match);
    return key;
  });

  text = text.replace(/`[^`\n]+`/g, (match) => {
    const key = `@@PROTECTED_BLOCK_${blocks.length}@@`;
    blocks.push(match);
    return key;
  });

  return { text, blocks };
}

function restoreBlocks(value: string, blocks: string[]): string {
  let result = value || "";

  blocks.forEach((block, index) => {
    result = result.replace(`@@PROTECTED_BLOCK_${index}@@`, block);
  });

  return result;
}

function looksLikeStandaloneLatex(line: string): boolean {
  const value = line.trim();

  if (!value) return false;
  if (value.startsWith("#")) return false;
  if (value.startsWith("|")) return false;
  if (value.startsWith(">")) return false;
  if (/^[-*+]\s+/.test(value)) return false;
  if (/^\d+[.)、]\s+/.test(value)) return false;
  if (value.includes("$")) return false;

  return /\\(frac|partial|mathrm|mathcal|tilde|sigma|varepsilon|mu|nu|Theta|cdot|sqrt|sum|prod|left|right)\b/.test(
    value
  );
}

function isDisplayWorthyTex(tex: string): boolean {
  const value = (tex || "").trim();

  if (!value) return false;

  // 短变量不要提升，例如 $t$、$C_{TC}^*$、$\mu_{TC}$
  if (value.length < 28) return false;

  return (
    value.includes("=") ||
    value.includes("\\frac") ||
    value.includes("\\partial") ||
    value.includes("\\mathcal") ||
    value.includes("\\sum") ||
    value.includes("\\prod") ||
    value.includes("\\int") ||
    value.includes("\\left") ||
    value.includes("\\right")
  );
}

function standardizeBlockMath(markdownText: string): string {
  // 把同一行里的 $$ ... $$ 统一变成标准块级公式：
  // 正文 $$ a=b $$ 后文
  // ->
  // 正文
  //
  // $$
  // a=b
  // $$
  //
  // 后文
  return (markdownText || "").replace(/\$\$([\s\S]*?)\$\$/g, (_, expr: string) => {
    const cleaned = String(expr || "").trim();

    if (!cleaned) return "";

    return `\n\n$$\n${cleaned}\n$$\n\n`;
  });
}

function promoteLongInlineMathToDisplay(markdownText: string): string {
  const lines = (markdownText || "").split("\n");
  const output: string[] = [];
  let inBlockMath = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "$$") {
      inBlockMath = !inBlockMath;
      output.push(line);
      continue;
    }

    if (inBlockMath) {
      output.push(line);
      continue;
    }

    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("|") ||
      trimmed.startsWith("@@PROTECTED_BLOCK_")
    ) {
      output.push(line);
      continue;
    }

    const inlineMathRe = /(^|[^\\])\$([^$\n]+?)\$/g;
    const parts: string[] = [];
    let lastIndex = 0;
    let changed = false;
    let match: RegExpExecArray | null;

    while ((match = inlineMathRe.exec(line)) !== null) {
      const prefix = match[1] || "";
      const tex = match[2] || "";
      const matchStart = match.index + prefix.length;
      const matchEnd = inlineMathRe.lastIndex;

      if (!isDisplayWorthyTex(tex)) {
        continue;
      }

      const before = line.slice(lastIndex, matchStart).trim();
      if (before) {
        parts.push(before);
      }

      parts.push("");
      parts.push("$$");
      parts.push(tex.trim());
      parts.push("$$");
      parts.push("");

      lastIndex = matchEnd;
      changed = true;
    }

    if (!changed) {
      output.push(line);
      continue;
    }

    const after = line.slice(lastIndex).trim();
    if (after) {
      parts.push(after);
    }

    output.push(parts.join("\n"));
  }

  return output.join("\n");
}

function wrapStandaloneLatexLines(markdownText: string): string {
  const lines = (markdownText || "").split("\n");
  const output: string[] = [];
  let inBlockMath = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "$$") {
      inBlockMath = !inBlockMath;
      output.push(line);
      continue;
    }

    if (!inBlockMath && looksLikeStandaloneLatex(trimmed)) {
      output.push("");
      output.push("$$");
      output.push(trimmed);
      output.push("$$");
      output.push("");
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

function renderInlineMathInText(text: string): string {
  let result = "";
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf("$", index);

    if (start < 0) {
      result += escapeHtml(text.slice(index));
      break;
    }

    // 转义美元符号
    if (start > 0 && text[start - 1] === "\\") {
      result += escapeHtml(text.slice(index, start - 1)) + "$";
      index = start + 1;
      continue;
    }

    // 双美元不在这里处理
    if (text[start + 1] === "$") {
      result += escapeHtml(text.slice(index, start + 2));
      index = start + 2;
      continue;
    }

    const end = text.indexOf("$", start + 1);

    if (end < 0) {
      result += escapeHtml(text.slice(index));
      break;
    }

    const before = text.slice(index, start);
    const tex = text.slice(start + 1, end);

    result += escapeHtml(before);
    result += `<span class="math-inline">${renderKatex(tex, false)}</span>`;

    index = end + 1;
  }

  return result;
}

function renderMathMarkdownToHtml(markdownText: string): string {
  let text = markdownText || "";

  // 先渲染块级公式。
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, expr: string) => {
    const cleaned = String(expr || "").trim();

    if (!cleaned) return "";

    return `\n\n<div class="math-display">${renderKatex(cleaned, true)}</div>\n\n`;
  });

  // 再逐行渲染行内公式，避免跨行把中文吞进去。
  text = text
    .split("\n")
    .map((line) => {
      if (!line.includes("$")) {
        return line;
      }

      return renderInlineMathInText(line);
    })
    .join("\n");

  return text;
}

function repairReportMarkdown(value: string): string {
  const { text, blocks } = protectBlocks(value || "");

  let repaired = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\\$/g, "$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$")
    .replace(/\\\[/g, "\n\n$$\n")
    .replace(/\\\]/g, "\n$$\n\n");

  // 修复历史报告中常见的嵌套美元符号：
  // $k_i^* ($i \in \mathbb{N}^+$) -> $k_i^*$（$i \in \mathbb{N}^+$）
  repaired = repaired.replace(
    /\$([^$\n]+?)\s*\(\$([^$\n]+?)\$\)/g,
    (_, before: string, inside: string) => {
      return `$${before.trim()}$（$${inside.trim()}$）`;
    }
  );

  repaired = repaired.replace(/（\*）/g, "（\\*）");

  // 防止 4 空格缩进把正文或公式变成代码块。
  repaired = repaired
    .split("\n")
    .map((line) => {
      if (/^( {4,}|\t)([\u4e00-\u9fa5A-Za-z0-9\\$#（(【\[])/.test(line)) {
        return line.replace(/^( {4,}|\t)+/, "");
      }
      return line;
    })
    .join("\n");

  repaired = standardizeBlockMath(repaired);
  repaired = wrapStandaloneLatexLines(repaired);
  repaired = promoteLongInlineMathToDisplay(repaired);
  repaired = standardizeBlockMath(repaired);

  repaired = renderMathMarkdownToHtml(repaired);
  repaired = repaired.replace(/\n{3,}/g, "\n\n");

  return restoreBlocks(repaired, blocks);
}

function stripMarkdownImageCaption(value: string): string {
  return (value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\$/g, "")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .trim();
}

function renderCaptionHtml(text: string): string {
  return renderInlineMathInText(text || "");
}

function CaptionHtml({ text }: { text: string }) {
  return (
    <span
      dangerouslySetInnerHTML={{
        __html: renderCaptionHtml(text),
      }}
    />
  );
}

export function MarkdownReport({
  markdown,
  images = {},
  normalize = false,
}: Props) {
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
        const finalSrc = findImageSrc(src, alt, images);

        if (!finalSrc) {
          return (
            <figure className="figure figure-missing">
              <div className="image-missing">
                图片未找到：{alt || src || "未命名图片"}
              </div>
            </figure>
          );
        }

        const safeAlt = stripMarkdownImageCaption(alt || "report image");

        return (
          <figure className="figure">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={finalSrc} alt={safeAlt || "report image"} loading="lazy" />
            {alt ? (
              <figcaption>
                <CaptionHtml text={alt} />
              </figcaption>
            ) : null}
          </figure>
        );
      },
    }),
    [images]
  );

  return (
    <div className="report-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={components as never}
        skipHtml={false}
      >
        {displayMarkdown || "暂无内容。"}
      </ReactMarkdown>
    </div>
  );
}

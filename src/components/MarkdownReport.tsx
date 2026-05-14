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

function repairLatexExpression(expr: string): string {
  return (expr || "")
    .trim()
    .replace(/\\frac\s*([A-Za-z0-9]+)\s*\{/g, "\\frac{$1}{")
    .replace(/\\frac\s*([A-Za-z0-9]+)\s+([A-Za-z0-9]+)/g, "\\frac{$1}{$2}")
    .replace(/\\mathrm\{F1\\text\{-\}score\}/g, "\\mathrm{F1\\text{-}score}");
}

function renderKatex(tex: string, displayMode: boolean): string {
  const cleaned = repairLatexExpression(tex || "");
  if (!cleaned) return "";

  try {
    return katex.renderToString(cleaned, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
    });
  } catch {
    const delimiter = displayMode ? "$$" : "$";
    return `${delimiter}${escapeHtml(cleaned)}${delimiter}`;
  }
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

  // PNG
  if (text.startsWith("iVBORw0KGgo")) return true;

  // JPEG
  if (text.startsWith("/9j/")) return true;

  // GIF
  if (text.startsWith("R0lGOD")) return true;

  // WEBP
  if (text.startsWith("UklGR")) return true;

  // SVG base64
  if (text.startsWith("PHN2Zy")) return true;

  // 很长且只包含 base64 字符，也按裸 base64 处理。
  return text.length > 500 && /^[A-Za-z0-9+/=]+$/.test(text);
}

function inferMimeFromBase64OrName(value: string, name?: string): string {
  const text = normalizeBase64(value || "");
  const lowerName = (name || "").toLowerCase();

  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lowerName.endsWith(".webp")) {
    return "image/webp";
  }

  if (lowerName.endsWith(".gif")) {
    return "image/gif";
  }

  if (lowerName.endsWith(".svg")) {
    return "image/svg+xml";
  }

  if (text.startsWith("/9j/")) {
    return "image/jpeg";
  }

  if (text.startsWith("R0lGOD")) {
    return "image/gif";
  }

  if (text.startsWith("UklGR")) {
    return "image/webp";
  }

  if (text.startsWith("PHN2Zy")) {
    return "image/svg+xml";
  }

  return "image/png";
}

function toImageSrc(value: unknown, fallbackName?: string): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;

    if (text.startsWith("data:image/")) {
      return text;
    }

    if (text.startsWith("http://") || text.startsWith("https://") || text.startsWith("blob:")) {
      return text;
    }

    // 重要：必须先判断裸 base64，再判断 "/" 路径。
    // JPEG base64 常以 /9j/ 开头，如果先判断 "/"，会被误当成站内路径。
    if (looksLikeBase64Image(text)) {
      const clean = normalizeBase64(text);
      const mime = inferMimeFromBase64OrName(clean, fallbackName);
      return `data:${mime};base64,${clean}`;
    }

    if (text.startsWith("/")) {
      return text;
    }

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

    if (raw.startsWith("data:image/")) {
      return raw;
    }

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
  // 如果 markdown 里的 src 本身就是 data URL、URL、站内路径或裸 base64，先直接规范化。
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

function repairReportMarkdown(value: string): string {
  const { text, blocks } = protectCodeBlocks(value || "");

  let repaired = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\\$/g, "$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$")
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$");

  // 防止模型输出的 4 空格缩进把公式/正文变成代码块。
  repaired = repaired
    .split("\n")
    .map((line) => {
      if (/^( {4,}|\t)([\u4e00-\u9fa5A-Za-z0-9\\$#（(【\[])/.test(line)) {
        return line.replace(/^( {4,}|\t)+/, "");
      }
      return line;
    })
    .join("\n");

  // 块级公式：$$ ... $$
  repaired = repaired.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr: string) => {
    return `\n\n<div class="math-display">${renderKatex(expr, true)}</div>\n\n`;
  });

  // 裸 LaTeX 行，例如：\mathrm{Recall} = ...
  repaired = repaired
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();

      if (
        trimmed &&
        !trimmed.includes("<span") &&
        !trimmed.includes("<div") &&
        /^\\(mathrm|frac|text|sqrt|sum|prod|alpha|beta|gamma|delta|lambda|mu|sigma|cdot|times|leq|geq)/.test(trimmed)
      ) {
        return `<div class="math-display">${renderKatex(trimmed, true)}</div>`;
      }

      return line;
    })
    .join("\n");

  // 行内公式
  repaired = repaired.replace(/(^|[^\\])\$([^\n$]+?)\$/g, (_, prefix: string, expr: string) => {
    return `${prefix}<span class="math-inline">${renderKatex(expr, false)}</span>`;
  });

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

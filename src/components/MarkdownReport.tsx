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

    // 注意：必须先判断 base64，再判断 "/"。
    // JPEG base64 常以 /9j/ 开头。
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

function protectBlocks(value: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];

  let text = (value || "").replace(/```[\s\S]*?```/g, (match) => {
    const key = `@@PROTECTED_BLOCK_${blocks.length}@@`;
    blocks.push(match);
    return key;
  });

  // 保护图片语法，避免图片 alt 里的 $...$ 被预处理破坏。
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

  return /\\(frac|partial|mathrm|mathcal|tilde|sigma|varepsilon|mu|nu|Theta|cdot|sqrt|sum|prod|left|right)\b/.test(value);
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

  // 只把“整行裸 LaTeX”包成块级公式。
  // 不再处理“中文 + 公式混在一行”的情况，避免把中文吞进 KaTeX。
  repaired = repaired
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();

      if (looksLikeStandaloneLatex(trimmed)) {
        return `\n$$\n${trimmed}\n$$\n`;
      }

      return line;
    })
    .join("\n");

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

function CaptionMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
      rehypePlugins={[rehypeRaw, rehypeKatex]}
      components={{
        p: ({ children }) => <>{children}</>,
      }}
      skipHtml={false}
    >
      {text || ""}
    </ReactMarkdown>
  );
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

        const safeAlt = stripMarkdownImageCaption(alt || "report image");

        return (
          <figure className="figure">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={finalSrc} alt={safeAlt || "report image"} loading="lazy" />
            {alt ? (
              <figcaption>
                <CaptionMarkdown text={alt} />
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
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={components as never}
        skipHtml={false}
      >
        {displayMarkdown || "暂无内容。"}
      </ReactMarkdown>
    </div>
  );
}

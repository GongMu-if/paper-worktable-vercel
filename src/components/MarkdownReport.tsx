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
  if (text.startsWith("iVBORw0KGgo")) return true;
  if (text.startsWith("/9j/")) return true;
  if (text.startsWith("R0lGOD")) return true;
  if (text.startsWith("UklGR")) return true;
  if (text.startsWith("PHN2Zy")) return true;

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

    if (
      text.startsWith("data:") ||
      text.startsWith("http://") ||
      text.startsWith("https://") ||
      text.startsWith("blob:")
    ) {
      return text;
    }

    // 关键修复：JPEG base64 常以 /9j/ 开头，不能先按 "/" 路径处理。
    if (looksLikeBase64Image(text) || text.startsWith("/9j/")) {
      const clean = normalizeBase64(text);
      const mime = inferMimeFromBase64OrName(clean, fallbackName);
      return `data:${mime};base64,${clean}`;
    }

    // 真正的站内路径放到 base64 判断之后。
    if (text.startsWith("/")) {
      return text;
    }

    // 后端 images_manifest 里的字符串通常就是裸 base64，保留宽松兼容。
    const clean = normalizeBase64(text);
    const mime = inferMimeFromBase64OrName(clean, fallbackName);
    return `data:${mime};base64,${clean}`;
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

    const raw =
      item.data ||
      item.base64 ||
      item.b64 ||
      item.content ||
      item.image_base64 ||
      item.imageData;

    // 关键修复：对象里如果有 raw/base64，优先处理 raw，不要先拿 path/src。
    if (raw) {
      if (raw.startsWith("data:")) return raw;

      const clean = normalizeBase64(raw);
      const mime =
        item.mime ||
        item.mime_type ||
        item.content_type ||
        inferMimeFromBase64OrName(clean, item.filename || item.name || fallbackName);

      return `data:${mime};base64,${clean}`;
    }

    const direct = item.url || item.src || item.path;
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

    return null;
  }

  return null;
}

function findImageSrc(
  src: string | undefined,
  alt: string | undefined,
  images: Record<string, ImageValue>
): string | null {
  // src 通常只是 markdown 中的图片 key / 文件名，不能直接当成 base64 转 data URL。
  // 必须先去 images_manifest 里按 key 找到对应的图片值，再转换。
  if (
    src &&
    (src.startsWith("data:") ||
      src.startsWith("http://") ||
      src.startsWith("https://") ||
      src.startsWith("/") ||
      src.startsWith("blob:"))
  ) {
    return src;
  }

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
    const key = `@@MD_REPORT_CODE_BLOCK_${blocks.length}@@`;
    blocks.push(match);
    return key;
  });

  text = text.replace(/`[^`\n]+`/g, (match) => {
    const key = `@@MD_REPORT_CODE_BLOCK_${blocks.length}@@`;
    blocks.push(match);
    return key;
  });

  return { text, blocks };
}

function restoreCodeBlocks(value: string, blocks: string[]): string {
  let result = value || "";

  blocks.forEach((block, index) => {
    result = result.replace(`@@MD_REPORT_CODE_BLOCK_${index}@@`, block);
  });

  return result;
}

function stripLeakedInternalPlaceholders(value: string): string {
  return (value || "")
    .replace(/^\s*@@(?:REPORT\\?_)?PROTECTED\\?_BLOCK\\?_\d+@@\s*$/gm, "")
    .replace(/@@(?:REPORT\\?_)?PROTECTED\\?_BLOCK\\?_\d+@@/g, "");
}

function normalizeDisplayMathBlocks(value: string): string {
  const { text, blocks } = protectCodeBlocks(value || "");

  let normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\\[/g, "\n\n$$\n")
    .replace(/\\\]/g, "\n$$\n\n");

  normalized = normalized.replace(/\$\$([\s\S]*?)\$\$/g, (_, expr: string) => {
    const cleaned = String(expr || "").trim();
    if (!cleaned) return "";
    return `\n\n$$\n${cleaned}\n$$\n\n`;
  });

  normalized = normalized.replace(/\n{3,}/g, "\n\n");
  return restoreCodeBlocks(normalized, blocks).trim();
}

function repairReportMarkdown(value: string): string {
  let repaired = value || "";
  repaired = stripLeakedInternalPlaceholders(repaired);
  repaired = normalizeDisplayMathBlocks(repaired);
  return repaired;
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
    <div
      className="report-markdown"
      style={{
        minWidth: 0,
        maxWidth: "100%",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        whiteSpace: "normal",
      }}
    >
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

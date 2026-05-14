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
      mime?: string;
      content_type?: string;
      filename?: string;
      name?: string;
      src?: string;
      url?: string;
    };

type Props = {
  markdown: string;
  images?: Record<string, ImageValue>;
  normalize?: boolean;
};

function normalizeKey(value: string | undefined): string {
  return decodeURIComponent(value || "")
    .trim()
    .replace(/^\.?\//, "")
    .replace(/^images\//, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function imageValueToSrc(value: ImageValue | undefined): string | null {
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
    return `data:image/png;base64,${text}`;
  }

  const direct = value.url || value.src;
  if (direct) return direct;

  const raw = value.data || value.base64;
  if (!raw) return null;
  if (raw.startsWith("data:")) return raw;

  const mime = value.mime || value.content_type || "image/png";
  return `data:${mime};base64,${raw}`;
}

function findImageSrc(
  src: string | undefined,
  alt: string | undefined,
  images: Record<string, ImageValue>
): string | null {
  const candidates = [src, alt].map(normalizeKey).filter(Boolean);

  for (const candidate of candidates) {
    for (const [name, value] of Object.entries(images || {})) {
      const key = normalizeKey(name);
      const valueName =
        typeof value === "object"
          ? normalizeKey(value.filename || value.name || value.src || value.url)
          : "";

      if (
        candidate === key ||
        key.endsWith(candidate) ||
        candidate.endsWith(key) ||
        (!!valueName &&
          (candidate === valueName ||
            valueName.endsWith(candidate) ||
            candidate.endsWith(valueName)))
      ) {
        return imageValueToSrc(value);
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

/**
 * 只修正常见报告格式问题，不直接把公式渲染成 HTML。
 * 公式交给 remark-math + rehype-katex 处理，避免出现
 * <span class="katex">...</span> 被 Markdown 当成代码块显示。
 */
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

  // 许多模型会把普通段落误缩进 4 个空格，Markdown 会把它们当代码块。
  // 保留 fenced code；只把明显的中文/英文正文缩进拉回正常段落。
  repaired = repaired
    .split("\n")
    .map((line) => {
      if (/^( {4,}|\t)([\u4e00-\u9fa5A-Za-z0-9（(【\[])/.test(line)) {
        return line.replace(/^( {4,}|\t)+/, "");
      }
      return line;
    })
    .join("\n");

  repaired = repaired.replace(/\$\s*\n\s*\$/g, "$$");

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

"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import katex from "katex";
import { normalizeReportMarkdown } from "@/lib/api";

type Props = {
  markdown: string;
  images?: Record<string, string>;
  normalize?: boolean;
};

function findImageBase64(src: string | undefined, images: Record<string, string>): string | null {
  const imageKey = (src || "").trim();
  if (!imageKey) return null;

  for (const [name, value] of Object.entries(images || {})) {
    if (imageKey === name || imageKey.includes(name) || name.includes(imageKey)) {
      return value;
    }
  }

  return null;
}

function escapeHtml(value: string): string {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderKatex(tex: string, displayMode: boolean): string {
  const cleaned = (tex || "").trim();
  if (!cleaned) return "";

  try {
    return katex.renderToString(cleaned, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false
    });
  } catch {
    const delimiter = displayMode ? "$$" : "$";
    return `${delimiter}${escapeHtml(cleaned)}${delimiter}`;
  }
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

function repairLatexText(value: string): string {
  return (value || "")
    .replace(/\\\$/g, "$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$")
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\in\s*\{([A-Za-z][A-Za-z\s,]*)\}/g, (_, items: string) => {
      const renderedItems = String(items)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => `\\mathrm{${item}}`)
        .join(", ");
      return `\\in \\{${renderedItems}\\}`;
    });
}

function renderMathInMarkdown(value: string): string {
  const repaired = repairLatexText(value || "");
  const { text, blocks } = protectCodeBlocks(repaired);

  let output = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr: string) => {
    return `\n\n<div class="math-display">${renderKatex(expr, true)}</div>\n\n`;
  });

  output = output.replace(/(^|[^\\])\$([^\n$]+?)\$/g, (_, prefix: string, expr: string) => {
    return `${prefix}<span class="math-inline">${renderKatex(expr, false)}</span>`;
  });

  return restoreCodeBlocks(output, blocks);
}

export function MarkdownReport({ markdown, images = {}, normalize = false }: Props) {
  const [displayMarkdown, setDisplayMarkdown] = useState(markdown || "");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!normalize) {
        setDisplayMarkdown(renderMathInMarkdown(markdown || ""));
        return;
      }

      try {
        const normalized = await normalizeReportMarkdown(markdown || "");
        if (!cancelled) {
          setDisplayMarkdown(renderMathInMarkdown(normalized || markdown || ""));
        }
      } catch {
        if (!cancelled) {
          setDisplayMarkdown(renderMathInMarkdown(markdown || ""));
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [markdown, normalize]);

  const components = useMemo(
    () => ({
      img: ({ src, alt }: { src?: string; alt?: string }) => {
        const b64 = findImageBase64(src, images);

        if (!b64) {
          return <span>{`![${alt || ""}](${src || ""})`}</span>;
        }

        const dataSrc = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;

        return (
          <figure className="figure">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dataSrc} alt={alt || "report image"} />
            {alt ? <figcaption>{alt}</figcaption> : null}
          </figure>
        );
      }
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

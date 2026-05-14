"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
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

function repairLatexMarkdown(value: string): string {
  return (value || "")
    .replace(/\\\$/g, "$")
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");
}

export function MarkdownReport({ markdown, images = {}, normalize = false }: Props) {
  const [displayMarkdown, setDisplayMarkdown] = useState(markdown || "");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!normalize) {
        setDisplayMarkdown(repairLatexMarkdown(markdown || ""));
        return;
      }

      try {
        const normalized = await normalizeReportMarkdown(markdown || "");
        if (!cancelled) setDisplayMarkdown(repairLatexMarkdown(normalized || markdown || ""));
      } catch {
        if (!cancelled) setDisplayMarkdown(repairLatexMarkdown(markdown || ""));
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
      },
    }),
    [images]
  );

  return (
    <div className="report-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={components as never}
        skipHtml={false}
      >
        {displayMarkdown || "暂无内容。"}
      </ReactMarkdown>
    </div>
  );
}

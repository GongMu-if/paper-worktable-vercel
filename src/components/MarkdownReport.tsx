"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

export function MarkdownReport({ markdown, images = {}, normalize = true }: Props) {
  const [displayMarkdown, setDisplayMarkdown] = useState(markdown || "");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!normalize) {
        setDisplayMarkdown(markdown || "");
        return;
      }
      try {
        const normalized = await normalizeReportMarkdown(markdown || "");
        if (!cancelled) setDisplayMarkdown(normalized || markdown || "");
      } catch {
        if (!cancelled) setDisplayMarkdown(markdown || "");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [markdown, normalize]);

  const components = useMemo(() => ({
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
  }), [images]);

  return (
    <div className="report-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>
        {displayMarkdown || "暂无内容。"}
      </ReactMarkdown>
    </div>
  );
}

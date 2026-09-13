// src/components/DescriptionExpander.tsx
"use client";

import { useState } from "react";

const MOBILE_LIMIT = 300;

export default function DescriptionExpander({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  const needsTruncation = text.length > MOBILE_LIMIT;

  return (
    <div>
      {/* Desktop: always show full */}
      <p className="hidden sm:block text-sm text-neutral-700 whitespace-pre-line leading-relaxed">
        {text}
      </p>
      {/* Mobile: truncated with expand */}
      <div className="sm:hidden">
        <p className="text-sm text-neutral-700 whitespace-pre-line leading-relaxed">
          {needsTruncation && !expanded ? text.slice(0, MOBILE_LIMIT) + "…" : text}
        </p>
        {needsTruncation && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-sm text-neutral-500 underline"
          >
            {expanded ? "Show less" : "Read more"}
          </button>
        )}
      </div>
    </div>
  );
}

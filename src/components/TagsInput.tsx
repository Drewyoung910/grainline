// src/components/TagsInput.tsx
"use client";

import * as React from "react";
import { normalizeTag } from "@/lib/tags";

export default function TagsInput({
  name = "tagsJson",
  initial = [],
  max = 10,
  placeholder = "Add a tag and press Enter",
}: {
  name?: string;          // hidden input name
  initial?: string[];     // starting tags
  max?: number;           // max chips
  placeholder?: string;
}) {
  const [tags, setTags] = React.useState<string[]>(
    Array.isArray(initial) ? initial : []
  );
  const [value, setValue] = React.useState("");

  const addTag = (raw: string) => {
    const t = normalizeTag(raw);
    if (!t) return;
    setTags((prev) => {
      if (prev.includes(t)) return prev;
      if (prev.length >= max) return prev;
      return [...prev, t];
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (value) addTag(value);
      setValue("");
    }
  };

  const onBlur = () => {
    if (value) addTag(value);
    setValue("");
  };

  const remove = (t: string) => {
    setTags((prev) => prev.filter((x) => x !== t));
  };

  // Support pasting comma/space-separated lists
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    const parts = text.split(/[,;\n]/g).map(normalizeTag).filter(Boolean);
    if (parts.length) {
      e.preventDefault();
      setTags((prev) => {
        const set = new Set(prev);
        for (const p of parts) {
          if (set.size >= max) break;
          set.add(p);
        }
        return Array.from(set);
      });
      setValue("");
    }
  };

  return (
    <div className="rounded-md border border-neutral-200 px-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1 text-xs"
          >
            #{t}
            <button
              type="button"
              onClick={() => remove(t)}
              className="rounded-full px-1 hover:bg-neutral-200"
              aria-label={`Remove ${t}`}
              title="Remove"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          onPaste={onPaste}
          placeholder={placeholder}
          className="min-w-[10ch] flex-1 bg-transparent text-sm outline-none"
        />
      </div>

      {/* Pass finalized list to the server action */}
      <input type="hidden" name={name} value={JSON.stringify(tags)} />

      <div className="mt-1 text-xs text-neutral-500">
        Up to {max} tags. We’ll normalize to lowercase and hyphens.
      </div>
    </div>
  );
}

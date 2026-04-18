"use client";

import { useRef, useState, useEffect } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  name?: string;
  required?: boolean;
};

export default function MarkdownToolbar({
  value,
  onChange,
  placeholder,
  rows = 16,
  name,
  required,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  function insertAtCursor(before: string, after = "") {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end);
    const replacement = before + selected + after;
    const newValue = value.slice(0, start) + replacement + value.slice(end);
    onChange(newValue);
    requestAnimationFrame(() => {
      ta.focus();
      const cursorPos = selected
        ? start + replacement.length
        : start + before.length;
      ta.setSelectionRange(cursorPos, cursorPos);
    });
  }

  function insertAtLineStart(prefix: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const newValue = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(newValue);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  }

  function handleCodeInsert() {
    const ta = textareaRef.current;
    if (!ta) return;
    const selected = value.slice(ta.selectionStart, ta.selectionEnd);
    if (selected.includes("\n")) {
      insertAtCursor("```\n", "\n```");
    } else {
      insertAtCursor("`", "`");
    }
  }

  const buttons: { label: string; title: string; action: () => void; className?: string }[] = [
    { label: "B", title: "Bold", action: () => insertAtCursor("**", "**"), className: "font-bold" },
    { label: "I", title: "Italic", action: () => insertAtCursor("*", "*"), className: "italic" },
    { label: "H2", title: "Heading 2", action: () => insertAtLineStart("## ") },
    { label: "H3", title: "Heading 3", action: () => insertAtLineStart("### ") },
    { label: "\u2022", title: "Bullet list", action: () => insertAtLineStart("- ") },
    { label: "1.", title: "Numbered list", action: () => insertAtLineStart("1. ") },
    { label: "\uD83D\uDD17", title: "Link", action: () => insertAtCursor("[", "](url)") },
    { label: "\uD83D\uDDBC", title: "Image", action: () => insertAtCursor("![alt](", ")") },
    { label: "</>", title: "Code", action: handleCodeInsert },
    { label: "\u275D", title: "Blockquote", action: () => insertAtLineStart("> ") },
  ];

  return (
    <div>
      {/* Hidden input ensures formData includes the body value */}
      {name && <input type="hidden" name={name} value={value} />}

      {/* Toolbar + Preview toggle */}
      <div className="flex items-center justify-between border border-neutral-300 rounded-t-lg bg-neutral-50 px-2 py-1.5">
        <div className="flex items-center gap-0.5 flex-wrap">
          {buttons.map((btn) => (
            <button
              key={btn.title}
              type="button"
              title={btn.title}
              onClick={btn.action}
              className={`px-2 py-1 text-sm rounded-md hover:bg-neutral-200
                transition-colors text-neutral-700 ${btn.className ?? ""}`}
            >
              {btn.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          className={`text-sm px-3 py-1 rounded-md transition-colors whitespace-nowrap
            ${showPreview
              ? "bg-neutral-900 text-white"
              : "text-neutral-600 hover:bg-neutral-200"
            }`}
        >
          {showPreview ? "Edit" : "Preview"}
        </button>
      </div>

      {/* Editor or Preview */}
      {showPreview ? (
        <PreviewPane markdown={value} />
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          rows={rows}
          className="w-full border border-t-0 border-neutral-300
            rounded-b-lg p-4 text-sm font-mono resize-y
            focus:outline-none focus:ring-2 focus:ring-neutral-300"
        />
      )}
    </div>
  );
}

function PreviewPane({ markdown }: { markdown: string }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("marked").then((m) => m.marked),
      import("sanitize-html"),
    ]).then(([marked, sanitizeHtml]) => {
      if (cancelled) return;
      const raw = marked.parse(markdown) as string;
      const clean = sanitizeHtml.default(raw, {
        allowedTags: sanitizeHtml.default.defaults.allowedTags.concat([
          "img", "h1", "h2", "h3", "h4", "h5", "h6",
          "hr", "del", "sup", "sub", "table", "thead",
          "tbody", "tr", "th", "td", "pre", "code",
        ]),
        allowedAttributes: {
          ...sanitizeHtml.default.defaults.allowedAttributes,
          img: ["src", "alt", "width", "height"],
          a: ["href", "target", "rel"],
          code: ["class"],
          pre: ["class"],
        },
        allowedSchemes: ["http", "https", "mailto"],
      });
      setHtml(clean);
    });
    return () => { cancelled = true; };
  }, [markdown]);

  if (!html && markdown) {
    return (
      <div className="w-full border border-t-0 border-neutral-300 rounded-b-lg p-4 min-h-[300px] bg-white text-sm text-neutral-400">
        Loading preview...
      </div>
    );
  }

  if (!markdown) {
    return (
      <div className="w-full border border-t-0 border-neutral-300 rounded-b-lg p-4 min-h-[300px] bg-white text-sm text-neutral-400 italic">
        Nothing to preview yet. Switch to Edit and start writing.
      </div>
    );
  }

  return (
    <div
      className="w-full border border-t-0 border-neutral-300
        rounded-b-lg p-4 min-h-[300px] prose prose-neutral max-w-none
        prose-headings:font-semibold prose-a:text-amber-700
        prose-img:rounded-xl bg-white"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

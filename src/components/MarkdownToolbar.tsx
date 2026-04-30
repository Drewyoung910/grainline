"use client";

import { useState, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TipTapLink from "@tiptap/extension-link";
import TipTapImage from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";
import { useToast } from "@/components/Toast";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  name?: string;
  required?: boolean;
};

function normalizeSafeLink(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) {
    return value;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return url.toString();
    }
  } catch (error) {
    console.warn("[markdown-toolbar] invalid link URL", error);
  }
  return null;
}

export default function MarkdownToolbar({
  value,
  onChange,
  placeholder,
  name,
}: Props) {
  const { toast } = useToast();
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const editor = useEditor({
    extensions: [
      StarterKit,
      TipTapLink.configure({ openOnClick: false }),
      TipTapImage,
      Markdown,
    ],
    content: value,
    onUpdate: ({ editor }) => {
      const storage = editor.storage as { markdown?: { getMarkdown: () => string } };
      const md = storage.markdown?.getMarkdown() ?? "";
      onChange(md);
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-neutral max-w-none prose-headings:font-semibold " +
          "prose-a:text-amber-700 prose-img:rounded-xl " +
          "p-4 min-h-[300px] focus:outline-none",
        "data-placeholder": placeholder ?? "Write your post...",
      },
    },
  });

  // Force re-render on every editor transaction so isActive() reflects current state
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const handler = () => setTick((t) => t + 1);
    editor.on("transaction", handler);
    return () => { editor.off("transaction", handler); };
  }, [editor]);

  if (!editor) return null;

  const btnClass = (active: boolean) =>
    `px-2 py-1 text-sm rounded-md transition-colors ${
      active
        ? "bg-neutral-900 text-white"
        : "text-neutral-700 hover:bg-neutral-200"
    }`;

  return (
    <div>
      {/* Hidden input for formData submission — always contains markdown */}
      {name && <input type="hidden" name={name} value={value} />}

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 flex-wrap border border-neutral-300 rounded-t-lg bg-neutral-50 px-2 py-1.5">
        <button
          type="button"
          title="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={btnClass(editor.isActive("bold"))}
        >
          <span className="font-bold">B</span>
        </button>
        <button
          type="button"
          title="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={btnClass(editor.isActive("italic"))}
        >
          <span className="italic">I</span>
        </button>
        <button
          type="button"
          title="Strikethrough"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={btnClass(editor.isActive("strike"))}
        >
          <span className="line-through">S</span>
        </button>

        <div className="w-px h-5 bg-neutral-300 mx-1" />

        <button
          type="button"
          title="Heading 2"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={btnClass(editor.isActive("heading", { level: 2 }))}
        >
          H2
        </button>
        <button
          type="button"
          title="Heading 3"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={btnClass(editor.isActive("heading", { level: 3 }))}
        >
          H3
        </button>

        <div className="w-px h-5 bg-neutral-300 mx-1" />

        <button
          type="button"
          title="Bullet list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={btnClass(editor.isActive("bulletList"))}
        >
          &bull;
        </button>
        <button
          type="button"
          title="Numbered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={btnClass(editor.isActive("orderedList"))}
        >
          1.
        </button>
        <button
          type="button"
          title="Blockquote"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={btnClass(editor.isActive("blockquote"))}
        >
          &ldquo;
        </button>
        <button
          type="button"
          title="Code block"
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={btnClass(editor.isActive("codeBlock"))}
        >
          {"</>"}
        </button>

        <div className="w-px h-5 bg-neutral-300 mx-1" />

        <button
          type="button"
          title="Link"
          onClick={() => {
            setShowLinkInput((open) => !open);
            setLinkUrl(editor.getAttributes("link").href ?? "");
          }}
          className={btnClass(editor.isActive("link"))}
        >
          Link
        </button>
        {showLinkInput && (
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              const safeUrl = normalizeSafeLink(linkUrl);
              if (!safeUrl) {
                toast("Enter a valid http, https, mailto, or internal URL.", "error");
                return;
              }
              editor.chain().focus().setLink({ href: safeUrl }).run();
              setShowLinkInput(false);
              setLinkUrl("");
            }}
          >
            <label className="sr-only" htmlFor="markdown-link-url">
              Link URL
            </label>
            <input
              id="markdown-link-url"
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://example.com"
              className="h-8 w-44 rounded-md border border-neutral-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />
            <button
              type="submit"
              className="h-8 rounded-md bg-neutral-900 px-2 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
              disabled={!linkUrl.trim()}
            >
              Apply
            </button>
            {editor.isActive("link") && (
              <button
                type="button"
                className="h-8 rounded-md border border-neutral-300 px-2 text-xs text-neutral-700 hover:bg-neutral-100"
                onClick={() => {
                  editor.chain().focus().unsetLink().run();
                  setShowLinkInput(false);
                  setLinkUrl("");
                }}
              >
                Remove
              </button>
            )}
            <button
              type="button"
              className="h-8 rounded-md border border-neutral-300 px-2 text-xs text-neutral-700 hover:bg-neutral-100"
              onClick={() => {
                setShowLinkInput(false);
                setLinkUrl("");
              }}
            >
              Cancel
            </button>
          </form>
        )}
        <button
          type="button"
          title="Image"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.onchange = async () => {
              const file = input.files?.[0];
              if (!file) return;
              try {
                if (file.type === "image/gif") {
                  throw new Error("Animated GIF uploads are not supported.");
                }

                const form = new FormData();
                form.set("file", file);
                form.set("endpoint", "galleryImage");
                form.set("fileIndex", "0");
                const uploadRes = await fetch("/api/upload/image", {
                  method: "POST",
                  body: form,
                });
                if (!uploadRes.ok) throw new Error("Upload failed");
                const { publicUrl } = await uploadRes.json() as { publicUrl: string };
                editor.chain().focus().setImage({ src: publicUrl }).run();
              } catch (error) {
                toast(
                  error instanceof Error
                    ? error.message
                    : "Image upload failed. The file may be too large (max 4MB).",
                  "error",
                );
              }
            };
            input.click();
          }}
          className={btnClass(false)}
        >
          Image
        </button>
        <button
          type="button"
          title="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className={btnClass(false)}
        >
          &#x2015;
        </button>
      </div>

      {/* Editor content area */}
      <div className="border border-t-0 border-neutral-300 rounded-b-lg bg-white">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

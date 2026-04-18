"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TipTapLink from "@tiptap/extension-link";
import TipTapImage from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  name?: string;
  required?: boolean;
};

export default function MarkdownToolbar({
  value,
  onChange,
  placeholder,
  name,
}: Props) {
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
            const url = prompt("Enter URL:");
            if (url) {
              editor.chain().focus().setLink({ href: url }).run();
            }
          }}
          className={btnClass(editor.isActive("link"))}
        >
          Link
        </button>
        <button
          type="button"
          title="Image"
          onClick={() => {
            const url = prompt("Enter image URL:");
            if (url) {
              editor.chain().focus().setImage({ src: url }).run();
            }
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

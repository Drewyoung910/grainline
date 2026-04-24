"use client";

import * as React from "react";
import { SubmitButton } from "@/components/ActionForm";
import { UploadButton } from "@/utils/uploadthing";
import { emitToast } from "@/components/Toast";

type Attachment = {
  id: string;
  name: string;
  type: string;
  url?: string;
  uploading: boolean;
};

const ENDPOINT = "messageAny" as const;

export default function MessageComposer({
  placeholder = "Write a message…",
}: { placeholder?: string }) {
  const [value, setValue] = React.useState("");
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const pendingIdsRef = React.useRef<string[]>([]);

  const isUploading = attachments.some((a) => a.uploading);
  const completed = attachments.filter((a) => !!a.url);
  const canSend = !isUploading && (value.trim().length > 0 || completed.length > 0);


  // Clear after successful submit (make sure ActionForm dispatches `actionform:ok`)
  React.useEffect(() => {
    const onOk = () => {
      setValue("");
      setAttachments([]);
      if (taRef.current) {
        taRef.current.value = "";
        taRef.current.style.height = "auto";
      }
    };
    document.addEventListener("actionform:ok", onOk);
    return () => document.removeEventListener("actionform:ok", onOk);
  }, []);

  const extractUrl = (x: unknown): string | null => {
    const obj = x as { serverData?: { url?: string }; ufsUrl?: string; url?: string; key?: string };
    return obj?.serverData?.url ?? obj?.ufsUrl ?? obj?.url ?? (obj?.key ? `https://utfs.io/f/${obj.key}` : null);
  };

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="sticky bottom-0 bg-white border-t px-3 pt-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
            >
              <span className="truncate max-w-[160px]">{a.name}</span>
              {a.uploading ? (
                <svg className="h-3.5 w-3.5 animate-spin text-neutral-500" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" fill="none" />
                </svg>
              ) : (
                <button
                  type="button"
                  aria-label="Remove file"
                  onClick={() => removeAttachment(a.id)}
                  className="rounded-full p-1 hover:bg-neutral-100"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* VISIBLE attach circle */}
        <div className="shrink-0">
          <UploadButton
            endpoint={ENDPOINT}
            appearance={{
              container: "inline-block align-bottom",
              // Force visible circle + dark icon regardless of inherited styles
              button:
                "h-9 w-9 rounded-full border border-neutral-300 bg-neutral-100 " +
                "p-0 flex items-center justify-center hover:bg-neutral-200 " +
                "focus:outline-none focus:ring-2 focus:ring-neutral-300",
              allowedContent: "hidden",
            }}
            content={{
              button: () => (
                <>
                  {/* Hard-coded dark strokes so it never blends into white */}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#111827" /* gray-800 */
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M21 15l-5-5-7 7-4-4" />
                  </svg>
                  <span className="sr-only">Attach files</span>
                </>
              ),
            }}
            onUploadBegin={(fileName) => {
              const id = crypto.randomUUID();
              pendingIdsRef.current.push(id);
              setAttachments((prev) => [
                ...prev,
                { id, name: fileName ?? "Uploading…", type: "", uploading: true },
              ]);
            }}
            onClientUploadComplete={(result) => {
              for (const r of result ?? []) {
                const id = pendingIdsRef.current.shift();
                if (!id) continue;
                const url = extractUrl(r);
                setAttachments((prev) =>
                  prev.map((a) =>
                    a.id === id
                      ? {
                          ...a,
                          uploading: false,
                          url: url ?? a.url,
                          name: (r as { name?: string })?.name ?? a.name,
                          type: (r as { type?: string })?.type ?? a.type,
                        }
                      : a
                  )
                );
              }
            }}
            onUploadError={(e) => {
              const id = pendingIdsRef.current.pop();
              if (id) setAttachments((prev) => prev.filter((a) => a.id !== id));
              emitToast(e?.message ?? "Upload failed", "error");
            }}
          />
        </div>

        <textarea
          ref={taRef}
          name="body"
          rows={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={placeholder}
          className="w-full resize-none rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300 max-h-40 overflow-y-auto"
        />

        {canSend ? (
          <SubmitButton className="rounded-full bg-black px-3 sm:px-4 py-2 text-white disabled:opacity-50 min-h-[40px] min-w-[40px] flex items-center justify-center">
            <span className="hidden sm:inline">Send</span>
            <svg className="sm:hidden h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </SubmitButton>
        ) : (
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-full bg-black/60 px-3 sm:px-4 py-2 text-white opacity-50 min-h-[40px] min-w-[40px] flex items-center justify-center"
          >
            <span className="hidden sm:inline">Send</span>
            <svg className="sm:hidden h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        )}
      </div>

      {/* Only completed uploads go to the server action */}
      <input
        type="hidden"
        name="attachments"
        value={JSON.stringify(
          completed.map(({ name, type, url }) => ({ name, type, url }))
        )}
      />

      <div className="mt-1 text-xs text-neutral-500">
        Attach images or PDFs. Files show here before you send.
      </div>
    </div>
  );
}













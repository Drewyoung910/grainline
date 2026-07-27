// src/components/CaseReplyBox.tsx
"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  UPLOAD_MAX_COUNTS,
  validateUploadFile,
} from "@/lib/uploadRules";

const MAX_CASE_MESSAGE_ATTACHMENTS =
  UPLOAD_MAX_COUNTS.caseEvidenceImage;

type PendingEvidence = {
  id: string;
  name: string;
  key: string | null;
  uploading: boolean;
  error: string | null;
};

export default function CaseReplyBox({
  caseId,
  attachmentsEnabled,
}: {
  caseId: string;
  attachmentsEnabled: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [evidence, setEvidence] = useState<PendingEvidence[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isUploading = evidence.some((item) => item.uploading);
  const hasUploadError = evidence.some((item) => item.error);

  async function uploadEvidence(files: File[]) {
    const remaining = MAX_CASE_MESSAGE_ATTACHMENTS - evidence.length;
    const selected = files.slice(0, remaining);
    if (selected.length === 0) return;

    const pending = selected.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      key: null,
      uploading: true,
      error: null,
    }));
    setEvidence((current) => [...current, ...pending]);
    setError(null);

    await Promise.all(
      selected.map(async (file, index) => {
        const pendingItem = pending[index];
        try {
          validateUploadFile(
            "caseEvidenceImage",
            file,
            evidence.length + index,
          );
          const form = new FormData();
          form.set("file", file);
          form.set("fileIndex", String(evidence.length + index));
          const response = await fetch(`/api/cases/${caseId}/attachments`, {
            method: "POST",
            body: form,
          });
          const data = (await response.json().catch(() => null)) as
            | { key?: string; error?: string }
            | null;
          if (!response.ok || !data?.key) {
            throw new Error(data?.error ?? "Evidence image upload failed.");
          }
          setEvidence((current) =>
            current.map((item) =>
              item.id === pendingItem.id
                ? { ...item, key: data.key!, uploading: false }
                : item,
            ),
          );
        } catch (uploadError) {
          const message =
            uploadError instanceof Error
              ? uploadError.message
              : "Evidence image upload failed.";
          setEvidence((current) =>
            current.map((item) =>
              item.id === pendingItem.id
                ? { ...item, uploading: false, error: message }
                : item,
            ),
          );
        }
      }),
    );
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || isUploading || hasUploadError) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          attachmentKeys: evidence
            .map((item) => item.key)
            .filter((key): key is string => Boolean(key)),
        }),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Failed to send");
        setLoading(false);
        return;
      }
      setBody("");
      setEvidence([]);
      setLoading(false);
      router.refresh();
    } catch {
      setError("Failed to send. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Write a reply…"
        className="w-full rounded border px-3 py-2 text-sm"
        disabled={loading || isUploading}
      />
      {attachmentsEnabled && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-neutral-700">
            Evidence images
            <span className="ml-1 font-normal text-neutral-500">
              (optional, up to {MAX_CASE_MESSAGE_ATTACHMENTS}; JPEG, PNG, or WebP)
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={
                loading
                || isUploading
                || evidence.length >= MAX_CASE_MESSAGE_ATTACHMENTS
              }
              onChange={(event) => {
                void uploadEvidence(Array.from(event.target.files ?? []));
              }}
              className="mt-1 block w-full text-xs text-neutral-600 file:mr-3 file:rounded-md file:border file:border-neutral-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-neutral-700"
            />
          </label>
          {evidence.length > 0 && (
            <ul className="space-y-1">
              {evidence.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate text-neutral-700">{item.name}</p>
                    <p
                      className={
                        item.error ? "text-red-600" : "text-neutral-500"
                      }
                    >
                      {item.uploading
                        ? "Uploading securely…"
                        : item.error ?? "Ready to send"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setEvidence((current) =>
                        current.filter((candidate) =>
                          candidate.id !== item.id
                        ),
                      )
                    }
                    disabled={loading || item.uploading}
                    className="shrink-0 border border-neutral-200 bg-white px-2 py-1 text-neutral-600 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading || isUploading || hasUploadError || !body.trim()}
        className="rounded bg-neutral-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {loading ? "Sending…" : isUploading ? "Uploading…" : "Send reply"}
      </button>
    </form>
  );
}

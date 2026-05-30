"use client";

import { useState } from "react";
import { useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { useToast } from "@/components/Toast";

type AccountExportResult =
  | {
      ok: true;
      blob: Blob;
      filename: string;
    }
  | {
      ok: false;
      error: string;
    };

function filenameFromContentDisposition(value: string | null) {
  const match = value?.match(/filename="([^"]+)"/);
  return match?.[1] ?? "grainline-account-export.json";
}

async function fetchAccountExport(): Promise<AccountExportResult | { clerk_error: unknown }> {
  const response = await fetch("/api/account/export", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      clerk_error?: unknown;
      error?: string;
    };
    if (data.clerk_error) return { clerk_error: data.clerk_error };
    return { ok: false, error: data.error ?? "Could not download account data." };
  }

  return {
    ok: true,
    blob: await response.blob(),
    filename: filenameFromContentDisposition(response.headers.get("content-disposition")),
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AccountExportButton() {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const downloadAccountExport = useReverification(fetchAccountExport);

  async function handleDownload() {
    setPending(true);
    try {
      const result = await downloadAccountExport();
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      downloadBlob(result.blob, result.filename);
      toast("Account data download started.", "success");
    } catch (error) {
      if (isReverificationCancelledError(error)) {
        toast("Account verification was cancelled.", "info");
        return;
      }
      toast("Could not download account data.", "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={pending}
      className="mt-4 inline-flex min-h-11 items-center rounded-md border border-neutral-200 px-4 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Preparing..." : "Download account data"}
    </button>
  );
}

// src/app/error.tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { Wrench } from "@/components/icons";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const existing = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const created = !existing;
    const previousContent = existing?.getAttribute("content") ?? null;
    const meta = existing ?? document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,nofollow";
    if (!existing) document.head.appendChild(meta);
    return () => {
      if (created) {
        meta.remove();
        return;
      }
      if (previousContent === null) {
        meta.removeAttribute("content");
        return;
      }
      meta.content = previousContent;
    };
  }, []);

  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-8 text-center space-y-6">
      <div className="text-neutral-500"><Wrench size={48} /></div>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Something splintered.
        </h1>
        <p className="text-neutral-500 max-w-md mx-auto">
          Something went wrong on our end. Try refreshing or come back in a moment.
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50"
        >
          Go Home
        </Link>
      </div>
    </main>
  );
}

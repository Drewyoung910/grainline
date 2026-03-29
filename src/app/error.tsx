// src/app/error.tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-8 text-center space-y-6">
      <div className="text-5xl">🪚</div>
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

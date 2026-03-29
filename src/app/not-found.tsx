// src/app/not-found.tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-8 text-center space-y-6">
      <div className="text-5xl">🪵</div>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Looks like this page got sanded down.
        </h1>
        <p className="text-neutral-500 max-w-md mx-auto">
          We couldn&apos;t find what you were looking for — it may have been moved or never existed.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/browse"
          className="inline-flex items-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Browse the Workshop
        </Link>
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

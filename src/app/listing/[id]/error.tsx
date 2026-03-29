// src/app/listing/[id]/error.tsx
"use client";

export default function ListingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const msg = error?.message || "";
  const isDbDown = msg.includes("Can't reach database");

  return (
    <main className="p-8 max-w-2xl mx-auto">
      <div className="rounded-xl border p-6 bg-red-50 border-red-200">
        <h2 className="text-lg font-semibold text-red-700 mb-2">
          {isDbDown ? "We can’t load this listing right now" : "Something went wrong"}
        </h2>
        <p className="text-sm text-red-700/80">
          {isDbDown
            ? "This usually resolves on its own. Please try again."
            : "An unexpected error occurred while loading this listing."}
        </p>

        <div className="mt-4 flex gap-2">
          <button
            onClick={reset}
            className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Try again
          </button>
          <a href="/browse" className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50">
            Back to Browse
          </a>
        </div>

        {process.env.NODE_ENV === "development" && (
          <details className="mt-4 text-xs text-red-700/70">
            <summary>Debug details</summary>
            <pre className="mt-2 whitespace-pre-wrap">
{error.message}
{error.stack}
            </pre>
          </details>
        )}
      </div>
    </main>
  );
}

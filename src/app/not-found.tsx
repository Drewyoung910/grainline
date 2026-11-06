// src/app/not-found.tsx
import Link from "next/link";
import { Logs } from "@/components/icons";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-8 text-center space-y-6">
      <div className="text-neutral-500"><Logs size={48} /></div>
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Looks like this page got sanded down.
        </h1>
        <p className="text-neutral-500 max-w-md mx-auto">
          We couldn&apos;t find that page. It may have moved or never existed.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/browse"
          className="btn btn-primary btn-sm"
        >
          Browse the Workshop
        </Link>
        <Link
          href="/"
          className="btn btn-secondary btn-sm"
        >
          Go Home
        </Link>
      </div>
    </main>
  );
}

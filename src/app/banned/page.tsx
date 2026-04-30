import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Account Suspended — Grainline",
  robots: { index: false },
};

export default function BannedPage() {
  return (
    <main className="min-h-[100svh] flex items-center justify-center px-4 bg-stone-50">
      <div className="text-center max-w-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.svg"
          alt="Grainline"
          className="h-8 w-auto mx-auto mb-8"
          style={{ filter: "brightness(0)" }}
        />
        <h1 className="text-2xl font-semibold mb-3">Account suspended</h1>
        <p className="text-neutral-500 text-sm mb-6">
          Your account has been suspended for violating our Terms of Service.
          If you believe this is an error, submit a support request or data request for review.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href="/support"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Contact support
          </Link>
          <Link
            href="/legal/data-request"
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            Data request
          </Link>
        </div>
      </div>
    </main>
  );
}

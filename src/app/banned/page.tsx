import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account Suspended — Grainline",
  robots: { index: false },
};

export default function BannedPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-stone-50">
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
          If you believe this is an error, contact us at{" "}
          <a href="mailto:support@thegrainline.com" className="underline">
            support@thegrainline.com
          </a>
        </p>
      </div>
    </main>
  );
}

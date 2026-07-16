import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="min-h-[100svh] flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.svg"
          alt="Grainline"
          className="h-8 w-auto mx-auto mb-6"
          style={{ filter: "brightness(0)" }}
        />
        <h1 className="font-display text-xl font-semibold mb-2">You&apos;re offline</h1>
        <p className="text-neutral-500 text-sm mb-6">
          Check your connection and try again.
        </p>
        <Link
          href="/"
          className="inline-block rounded-md border border-neutral-900 px-6 py-2 text-sm hover:bg-neutral-50"
        >
          Try again
        </Link>
      </div>
    </main>
  )
}

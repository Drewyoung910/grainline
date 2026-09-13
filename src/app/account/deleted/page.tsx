import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Account Deleted",
  robots: { index: false, follow: false },
};

export default function AccountDeletedPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <section className="card-section p-8">
        <h1 className="font-display text-3xl font-semibold text-neutral-950">Your account has been deleted.</h1>
        <p className="mt-4 text-sm leading-6 text-neutral-600">
          We&apos;ve signed you out. If you didn&apos;t intend to do this, contact{" "}
          <a href="mailto:support@thegrainline.com" className="underline hover:text-neutral-900">
            support@thegrainline.com
          </a>
          .
        </p>
        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            Return home
          </Link>
        </div>
      </section>
    </main>
  );
}

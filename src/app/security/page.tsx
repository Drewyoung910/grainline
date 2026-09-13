import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Security | Grainline",
  description: "How to report a security vulnerability to Grainline.",
  alternates: { canonical: "https://thegrainline.com/security" },
};

export default function SecurityPage() {
  return (
    <main className="min-h-[100svh] bg-[#F7F5F0] px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-3">
          <p className="text-sm font-medium text-neutral-500">Security</p>
          <h1 className="font-display text-3xl font-semibold text-neutral-950 sm:text-4xl">
            Report a security issue
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-neutral-600">
            If you believe you have found a vulnerability in Grainline, please send enough detail for us to
            reproduce and understand the impact. We review security reports separately from normal support.
          </p>
        </header>

        <section className="card-section space-y-4 p-6 text-sm leading-6 text-neutral-700">
          <h2 className="font-display text-xl font-semibold text-neutral-950">Contact</h2>
          <p>
            Email{" "}
            <a href="mailto:security@thegrainline.com" className="font-medium underline hover:text-neutral-950">
              security@thegrainline.com
            </a>{" "}
            with a concise description, affected URL or endpoint, reproduction steps, expected impact, and any
            safe proof of concept.
          </p>
          <p>
            For normal account, order, or seller issues, use{" "}
            <Link href="/support" className="underline hover:text-neutral-950">
              Grainline support
            </Link>{" "}
            instead so the right queue receives it.
          </p>
        </section>

        <section className="card-section space-y-4 p-6 text-sm leading-6 text-neutral-700">
          <h2 className="font-display text-xl font-semibold text-neutral-950">Safe testing guidelines</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>Use your own account and test data whenever possible.</li>
            <li>Do not access, modify, delete, or disclose another person&apos;s data.</li>
            <li>Do not run destructive, denial-of-service, spam, social-engineering, or physical attacks.</li>
            <li>Do not attempt payment fraud, seller payout manipulation, or shipment-label abuse.</li>
            <li>Stop testing and report promptly if you encounter private data or a live money movement risk.</li>
          </ul>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-[#EFEAE0] p-6 text-sm leading-6 text-neutral-700">
          <h2 className="font-display text-xl font-semibold text-neutral-950">Coordinated disclosure</h2>
          <p>
            We ask reporters to give Grainline a reasonable opportunity to investigate and fix verified issues
            before public disclosure. We do not currently operate a paid bug bounty program.
          </p>
          <p className="mt-3">
            Machine-readable disclosure details are also available at{" "}
            <a href="/.well-known/security.txt" className="underline hover:text-neutral-950">
              /.well-known/security.txt
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}

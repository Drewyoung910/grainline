import type { Metadata } from "next";
import Link from "next/link";
import SupportRequestForm from "@/components/SupportRequestForm";

export const metadata: Metadata = {
  title: "Data Request — Grainline",
  description: "Submit a Grainline privacy, account access, deletion, correction, portability, opt-out, or appeal request.",
  robots: { index: false, follow: true },
};

const DATA_REQUEST_TOPICS = [
  { value: "access", label: "Access my data" },
  { value: "delete", label: "Delete my data" },
  { value: "correct", label: "Correct my data" },
  { value: "portability", label: "Export or portability" },
  { value: "opt_out", label: "Opt out" },
  { value: "appeal", label: "Appeal a decision" },
  { value: "other", label: "Other privacy request" },
];

export default function DataRequestPage() {
  return (
    <main className="min-h-[100svh] bg-stone-50 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-3">
          <p className="text-sm font-medium text-neutral-500">Legal</p>
          <h1 className="font-display text-3xl font-semibold text-neutral-950 sm:text-4xl">
            Privacy and account data request
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-neutral-600">
            Use this form when you cannot access your account, need a privacy-rights request recorded, or need to appeal an account decision.
          </p>
        </header>

        <SupportRequestForm
          endpoint="/api/legal/data-request"
          topics={DATA_REQUEST_TOPICS}
          submitLabel="Submit data request"
          successTitle="Data request recorded"
          successMessage="Legal has a durable record of your request and the response deadline."
          includeOrderField={false}
        />

        <section className="rounded-lg border border-neutral-200 bg-white px-5 py-4 text-sm leading-6 text-neutral-700">
          <h2 className="mb-2 font-semibold text-neutral-950">Direct legal contact</h2>
          <p>
            The form creates a trackable request. You can also contact{" "}
            <a href="mailto:legal@thegrainline.com" className="underline hover:text-neutral-950">
              legal@thegrainline.com
            </a>
            . See the{" "}
            <Link href="/privacy" className="underline hover:text-neutral-950">
              Privacy Policy
            </Link>
            {" "}for more detail on data rights and retention.
          </p>
        </section>
      </div>
    </main>
  );
}

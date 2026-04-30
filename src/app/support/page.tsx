import type { Metadata } from "next";
import Link from "next/link";
import SupportRequestForm from "@/components/SupportRequestForm";

export const metadata: Metadata = {
  title: "Support — Grainline",
  description: "Contact Grainline support about orders, accounts, seller issues, payments, or site problems.",
  alternates: { canonical: "https://thegrainline.com/support" },
};

const SUPPORT_TOPICS = [
  { value: "order", label: "Order" },
  { value: "account", label: "Account" },
  { value: "seller", label: "Seller or maker" },
  { value: "payment", label: "Payment" },
  { value: "bug", label: "Site problem" },
  { value: "other", label: "Other" },
];

export default function SupportPage() {
  return (
    <main className="min-h-[100svh] bg-stone-50 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-3">
          <p className="text-sm font-medium text-neutral-500">Support</p>
          <h1 className="font-display text-3xl font-semibold text-neutral-950 sm:text-4xl">
            Get help from Grainline
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-neutral-600">
            Send order, account, payment, seller, or site issues to the support queue. Each request gets a reference ID for follow-up.
          </p>
        </header>

        <SupportRequestForm
          endpoint="/api/support"
          topics={SUPPORT_TOPICS}
          submitLabel="Send request"
          successTitle="Support request received"
          successMessage="The support queue has your request. Keep the request ID for follow-up."
        />

        <section className="rounded-lg border border-neutral-200 bg-white px-5 py-4 text-sm leading-6 text-neutral-700">
          <h2 className="mb-2 font-semibold text-neutral-950">Other contacts</h2>
          <p>
            For privacy rights or account access requests, use the{" "}
            <Link href="/legal/data-request" className="underline hover:text-neutral-950">
              legal data request form
            </Link>
            . For urgent email follow-up, contact{" "}
            <a href="mailto:support@thegrainline.com" className="underline hover:text-neutral-950">
              support@thegrainline.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}

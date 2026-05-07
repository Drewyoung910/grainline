"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { CURRENT_TERMS_VERSION } from "@/lib/termsAcceptance";

export default function AcceptTermsForm({ redirectUrl }: { redirectUrl: string }) {
  const router = useRouter();
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [ageAttested, setAgeAttested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!termsAccepted || !ageAttested || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/account/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termsAccepted: true,
          ageAttested: true,
          termsVersion: CURRENT_TERMS_VERSION,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not save your acceptance. Please try again.");
      }

      router.replace(redirectUrl);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your acceptance. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-5">
      <label className="flex gap-3 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={termsAccepted}
          onChange={(event) => setTermsAccepted(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-neutral-900"
        />
        <span>
          I agree to Grainline&apos;s{" "}
          <Link href="/terms" className="underline hover:text-neutral-900" target="_blank" rel="noopener noreferrer">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline hover:text-neutral-900" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      <label className="flex gap-3 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={ageAttested}
          onChange={(event) => setAgeAttested(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-neutral-900"
        />
        <span>I confirm that I am at least 18 years old.</span>
      </label>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!termsAccepted || !ageAttested || submitting}
        className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Saving..." : "Continue"}
      </button>
    </form>
  );
}

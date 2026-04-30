"use client";

import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { useState } from "react";
import { signInPathForRedirect } from "@/lib/internalReturnUrl";

const TERMS_VERSION = "2026-03-30";

export default function SignUpTermsGate({ redirectUrl }: { redirectUrl: string }) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [ageAttested, setAgeAttested] = useState(false);
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null);

  if (acceptedAt) {
    return (
      <main className="min-h-[100svh] flex items-center justify-center p-8">
        <SignUp
          routing="hash"
          signInUrl={signInPathForRedirect(redirectUrl)}
          forceRedirectUrl={redirectUrl}
          fallbackRedirectUrl={redirectUrl}
          unsafeMetadata={{
            termsAcceptedAt: acceptedAt,
            termsVersion: TERMS_VERSION,
            ageAttestedAt: acceptedAt,
            ageAttested: true,
          }}
        />
      </main>
    );
  }

  return (
    <main className="min-h-[100svh] flex items-center justify-center p-8 bg-[#F7F5F0]">
      <section className="card-section max-w-md p-6">
        <p className="text-sm text-neutral-500">Create your account</p>
        <h1 className="mt-1 text-2xl font-semibold font-display">A few things first</h1>
        <div className="mt-5 space-y-4 text-sm text-neutral-700">
          <label className="flex gap-3">
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
          <label className="flex gap-3">
            <input
              type="checkbox"
              checked={ageAttested}
              onChange={(event) => setAgeAttested(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-neutral-900"
            />
            <span>I confirm that I am at least 18 years old.</span>
          </label>
        </div>
        <button
          type="button"
          disabled={!termsAccepted || !ageAttested}
          onClick={() => setAcceptedAt(new Date().toISOString())}
          className="mt-6 w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
        </button>
        <p className="mt-4 text-center text-xs text-neutral-500">
          Already have an account?{" "}
          <Link href={signInPathForRedirect(redirectUrl)} className="underline hover:text-neutral-700">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}

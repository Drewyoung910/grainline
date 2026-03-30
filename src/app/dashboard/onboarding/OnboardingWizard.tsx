"use client";

import { useState } from "react";
import Link from "next/link";
import ProfileAvatarUploader from "@/components/ProfileAvatarUploader";
import { saveStep1, saveStep2, advanceStep, completeOnboarding } from "./actions";

interface Props {
  initialStep: number;
  displayName: string;
  bio: string | null;
  tagline: string | null;
  avatarImageUrl: string | null;
  yearsInBusiness: number | null;
  city: string | null;
  state: string | null;
  returnPolicy: string | null;
  shippingPolicy: string | null;
  acceptsCustomOrders: boolean;
  /** Stripe account ID exists (but may not be fully set up) */
  hasStripeAccount: boolean;
  /** Stripe account is fully onboarded and charges_enabled = true */
  chargesEnabled: boolean;
  listingCount: number;
}

const TOTAL_STEPS = 5;

export default function OnboardingWizard({
  initialStep,
  displayName,
  bio,
  tagline,
  avatarImageUrl,
  yearsInBusiness,
  city,
  state,
  returnPolicy,
  shippingPolicy,
  acceptsCustomOrders,
  hasStripeAccount,
  chargesEnabled,
  listingCount,
}: Props) {
  const [step, setStep] = useState(initialStep);
  const [loading, setLoading] = useState(false);
  const [connectingStripe, setConnectingStripe] = useState(false);

  // Track what was completed during the session (for summary on step 5)
  const [completed, setCompleted] = useState({
    step1: !!(bio || tagline || avatarImageUrl),
    step2: !!(city && state),
    step3: chargesEnabled,
    step4: listingCount > 0,
  });

  const progressPct = Math.round((step / TOTAL_STEPS) * 100);

  async function advance(targetStep: number) {
    setLoading(true);
    try {
      await advanceStep(targetStep);
      setStep(targetStep);
    } finally {
      setLoading(false);
    }
  }

  async function handleStep1Submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setLoading(true);
    try {
      await saveStep1(formData);
      setCompleted((c) => ({ ...c, step1: true }));
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  async function handleStep2Submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setLoading(true);
    try {
      await saveStep2(formData);
      setCompleted((c) => ({ ...c, step2: true }));
      setStep(3);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectStripe() {
    setConnectingStripe(true);
    try {
      const res = await fetch("/api/stripe/connect/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ returnUrl: "/dashboard/onboarding" }),
      });
      const data = await res.json();
      if (data.url) {
        // Advance step before redirecting so they return to step 4
        await advanceStep(4);
        window.location.href = data.url;
      }
    } catch {
      setConnectingStripe(false);
    }
  }

  async function handleComplete() {
    setLoading(true);
    try {
      await completeOnboarding();
    } catch {
      setLoading(false);
    }
  }

  const inputClass =
    "w-full border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400";
  const btnPrimary =
    "flex-1 bg-amber-500 hover:bg-amber-600 text-white font-medium px-4 py-2.5 text-sm min-h-[44px] disabled:opacity-50 transition-colors";
  const btnSecondary =
    "flex-1 border border-neutral-200 px-4 py-2.5 text-sm text-neutral-600 hover:bg-neutral-50 min-h-[44px] disabled:opacity-50";

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-start py-12 px-4">
      <div className="w-full max-w-xl">
        {/* Progress bar — visible on steps 1–4 */}
        {step > 0 && step < TOTAL_STEPS && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-neutral-500">Step {step} of {TOTAL_STEPS - 1}</span>
              <span className="text-xs text-neutral-500">{progressPct}%</span>
            </div>
            <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Step 0: Welcome ─────────────────────────────────── */}
        {step === 0 && (
          <div className="border border-neutral-200 bg-white p-8 text-center">
            <div className="text-5xl mb-4">🪵</div>
            <h1 className="text-2xl font-bold mb-2">
              Welcome to Grainline, {displayName}!
            </h1>
            <p className="text-neutral-600 mb-8">
              Let&apos;s get your shop set up. It takes about 5 minutes.
            </p>
            <button
              onClick={() => advance(1)}
              disabled={loading}
              className="bg-amber-500 hover:bg-amber-600 text-white font-medium px-8 py-3 min-h-[44px] disabled:opacity-50 transition-colors"
            >
              {loading ? "Loading…" : "Get Started →"}
            </button>
          </div>
        )}

        {/* ── Step 1: Your Profile ─────────────────────────────── */}
        {step === 1 && (
          <div className="border border-neutral-200 bg-white p-8">
            <h2 className="text-xl font-bold mb-1">Your Profile</h2>
            <p className="text-sm text-neutral-500 mb-6">
              This is how buyers will know you. Tell them about your craft.
            </p>
            <form onSubmit={handleStep1Submit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="displayName">
                  Display Name
                </label>
                <input
                  id="displayName"
                  name="displayName"
                  type="text"
                  defaultValue={displayName}
                  maxLength={100}
                  className={inputClass}
                  placeholder="Your shop or maker name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="tagline">
                  Tagline{" "}
                  <span className="text-neutral-400 font-normal">(optional)</span>
                </label>
                <input
                  id="tagline"
                  name="tagline"
                  type="text"
                  defaultValue={tagline ?? ""}
                  maxLength={100}
                  className={inputClass}
                  placeholder="e.g. Handcrafted from reclaimed oak"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="bio">
                  Bio{" "}
                  <span className="text-neutral-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="bio"
                  name="bio"
                  defaultValue={bio ?? ""}
                  maxLength={500}
                  rows={4}
                  className={inputClass}
                  placeholder="Tell buyers about yourself and your craft…"
                />
              </div>

              <div>
                <p className="block text-sm font-medium mb-2">
                  Profile Photo{" "}
                  <span className="text-neutral-400 font-normal">(optional)</span>
                </p>
                <ProfileAvatarUploader initialUrl={avatarImageUrl} />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => advance(2)}
                  disabled={loading}
                  className={btnSecondary}
                >
                  Skip for now
                </button>
                <button type="submit" disabled={loading} className={btnPrimary}>
                  {loading ? "Saving…" : "Save & Continue →"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Step 2: Your Shop ────────────────────────────────── */}
        {step === 2 && (
          <div className="border border-neutral-200 bg-white p-8">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-sm text-neutral-500 hover:text-neutral-700 mb-4 block"
            >
              ← Back
            </button>
            <h2 className="text-xl font-bold mb-1">Your Shop</h2>
            <p className="text-sm text-neutral-500 mb-6">
              Help buyers know what to expect when shopping with you.
            </p>
            <form onSubmit={handleStep2Submit} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" htmlFor="city">
                    City{" "}
                    <span className="text-neutral-400 font-normal">(optional)</span>
                  </label>
                  <input
                    id="city"
                    name="city"
                    type="text"
                    defaultValue={city ?? ""}
                    className={inputClass}
                    placeholder="Austin"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" htmlFor="state">
                    State{" "}
                    <span className="text-neutral-400 font-normal">(optional)</span>
                  </label>
                  <input
                    id="state"
                    name="state"
                    type="text"
                    defaultValue={state ?? ""}
                    className={inputClass}
                    placeholder="TX"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="yearsInBusiness">
                  Years in Business{" "}
                  <span className="text-neutral-400 font-normal">(optional)</span>
                </label>
                <input
                  id="yearsInBusiness"
                  name="yearsInBusiness"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={yearsInBusiness ?? ""}
                  className={inputClass}
                  placeholder="e.g. 5"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="returnPolicy">
                  Return Policy{" "}
                  <span className="text-neutral-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="returnPolicy"
                  name="returnPolicy"
                  defaultValue={returnPolicy ?? ""}
                  rows={3}
                  className={inputClass}
                  placeholder="e.g. All sales final. Contact me within 7 days for damaged items."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="shippingPolicy">
                  Shipping Policy{" "}
                  <span className="text-neutral-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="shippingPolicy"
                  name="shippingPolicy"
                  defaultValue={shippingPolicy ?? ""}
                  rows={3}
                  className={inputClass}
                  placeholder="e.g. Ships within 3 business days via UPS Ground."
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  id="acceptsCustomOrders"
                  name="acceptsCustomOrders"
                  type="checkbox"
                  defaultChecked={acceptsCustomOrders}
                  className="h-4 w-4"
                />
                <label htmlFor="acceptsCustomOrders" className="text-sm font-medium">
                  I accept custom orders
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => advance(3)}
                  disabled={loading}
                  className={btnSecondary}
                >
                  Skip for now
                </button>
                <button type="submit" disabled={loading} className={btnPrimary}>
                  {loading ? "Saving…" : "Save & Continue →"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Step 3: Get Paid ─────────────────────────────────── */}
        {step === 3 && (
          <div className="border border-neutral-200 bg-white p-8">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="text-sm text-neutral-500 hover:text-neutral-700 mb-4 block"
            >
              ← Back
            </button>
            <h2 className="text-xl font-bold mb-1">Get Paid</h2>
            <p className="text-sm text-neutral-500 mb-6">
              Grainline uses Stripe to send you money when you make a sale. Setup takes 2 minutes.
            </p>

            {chargesEnabled || completed.step3 ? (
              // Fully connected and charges enabled
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 px-4 py-4 mb-6">
                <span className="text-green-600 text-lg">✓</span>
                <div>
                  <p className="font-medium text-green-800">Stripe Connected</p>
                  <p className="text-sm text-green-700">
                    You&apos;re all set to receive payouts.
                  </p>
                </div>
              </div>
            ) : hasStripeAccount ? (
              // Account exists but setup not complete
              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 px-4 py-3 mb-3">
                  <span className="text-amber-600 text-lg">⚠</span>
                  <div>
                    <p className="font-medium text-amber-800">Stripe Setup Incomplete</p>
                    <p className="text-sm text-amber-700">
                      Your Stripe account exists but isn&apos;t fully set up yet.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleConnectStripe}
                  disabled={connectingStripe || loading}
                  className="w-full bg-[#635bff] hover:bg-[#5147e6] text-white font-medium px-6 py-3 min-h-[44px] disabled:opacity-50 transition-colors"
                >
                  {connectingStripe ? "Connecting…" : "Continue Stripe Setup →"}
                </button>
              </div>
            ) : (
              // No Stripe account yet
              <div className="space-y-3 mb-6">
                <button
                  onClick={handleConnectStripe}
                  disabled={connectingStripe || loading}
                  className="w-full bg-[#635bff] hover:bg-[#5147e6] text-white font-medium px-6 py-3 min-h-[44px] disabled:opacity-50 transition-colors"
                >
                  {connectingStripe ? "Connecting…" : "Connect Stripe →"}
                </button>
                <p className="text-xs text-neutral-500">
                  You can still create listings without Stripe, but you won&apos;t receive payouts
                  until connected.
                </p>
              </div>
            )}

            <button
              onClick={() => advance(4)}
              disabled={loading}
              className="w-full border border-neutral-200 px-4 py-2.5 text-sm text-neutral-600 hover:bg-neutral-50 min-h-[44px] disabled:opacity-50"
            >
              {loading
                ? "Loading…"
                : chargesEnabled || completed.step3
                ? "Continue →"
                : "Skip for now"}
            </button>
          </div>
        )}

        {/* ── Step 4: Your First Listing ───────────────────────── */}
        {step === 4 && (
          <div className="border border-neutral-200 bg-white p-8">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="text-sm text-neutral-500 hover:text-neutral-700 mb-4 block"
            >
              ← Back
            </button>
            <h2 className="text-xl font-bold mb-1">Your First Listing</h2>
            <p className="text-sm text-neutral-500 mb-6">
              Show buyers what you make. You can always add more later.
            </p>

            {listingCount > 0 || completed.step4 ? (
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 px-4 py-4 mb-6">
                <span className="text-green-600 text-lg">✓</span>
                <div>
                  <p className="font-medium text-green-800">You already have listings!</p>
                  <p className="text-sm text-green-700">
                    {listingCount} listing{listingCount !== 1 ? "s" : ""} in your shop.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mb-6">
                <Link
                  href="/dashboard/listings/new"
                  className="block w-full text-center bg-amber-500 hover:bg-amber-600 text-white font-medium px-6 py-3 min-h-[44px] transition-colors"
                >
                  Create a Listing →
                </Link>
              </div>
            )}

            <button
              onClick={() => advance(5)}
              disabled={loading}
              className="w-full border border-neutral-200 px-4 py-2.5 text-sm text-neutral-600 hover:bg-neutral-50 min-h-[44px] disabled:opacity-50"
            >
              {loading
                ? "Loading…"
                : listingCount > 0 || completed.step4
                ? "Continue →"
                : "I'll do this later"}
            </button>
          </div>
        )}

        {/* ── Step 5: All set! ─────────────────────────────────── */}
        {step === 5 && (
          <div className="border border-neutral-200 bg-white p-8 text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold mb-2">Your shop is ready!</h2>
            <p className="text-neutral-600 mb-6">Here&apos;s a summary of what you set up:</p>

            <div className="text-left border border-neutral-200 divide-y divide-neutral-100 mb-8">
              <div className="flex items-center gap-3 px-4 py-3">
                <span
                  className={
                    completed.step1 ? "text-green-600 font-medium" : "text-neutral-300 font-medium"
                  }
                >
                  {completed.step1 ? "✓" : "○"}
                </span>
                <span className="text-sm">Profile — display name, bio &amp; tagline</span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <span
                  className={
                    completed.step2 ? "text-green-600 font-medium" : "text-neutral-300 font-medium"
                  }
                >
                  {completed.step2 ? "✓" : "○"}
                </span>
                <span className="text-sm">Shop — location &amp; policies</span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <span
                  className={
                    chargesEnabled || completed.step3
                      ? "text-green-600 font-medium"
                      : "text-neutral-300 font-medium"
                  }
                >
                  {chargesEnabled || completed.step3 ? "✓" : "○"}
                </span>
                <span className="text-sm">Stripe payouts connected</span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <span
                  className={
                    listingCount > 0 || completed.step4
                      ? "text-green-600 font-medium"
                      : "text-neutral-300 font-medium"
                  }
                >
                  {listingCount > 0 || completed.step4 ? "✓" : "○"}
                </span>
                <span className="text-sm">First listing created</span>
              </div>
            </div>

            <button
              onClick={handleComplete}
              disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white font-medium px-8 py-3 min-h-[44px] disabled:opacity-50 transition-colors"
            >
              {loading ? "Loading…" : "Go to My Dashboard →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

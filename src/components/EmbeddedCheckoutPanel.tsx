"use client";

import { useEffect, useRef, useState } from "react";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;

// Stripe's form arrives as an iframe that grows from nothing; until it has
// drawn, a shimmer holds its place so the step does not look empty.
const STRIPE_FORM_DRAWN_PX = 160;
const PLACEHOLDER_GIVE_UP_MS = 10_000;

function CheckoutFormPlaceholder({ leaving }: { leaving: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 top-0 space-y-4${leaving ? " checkout-placeholder-out" : ""}`}
    >
      {[
        "h-11 w-full",
        "h-11 w-full",
        "h-4 w-1/3",
        "h-11 w-full",
        "h-11 w-2/3",
        "h-12 w-full",
      ].map((size, index) => (
        <div key={index} className={`card-shimmer relative rounded-md bg-[#EFEAE0] ${size}`} />
      ))}
    </div>
  );
}

type Props = {
  clientSecret: string;
  onComplete: () => void;
  sellerName: string;
  currentIndex: number;
  totalCount: number;
};

export default function EmbeddedCheckoutPanel({ clientSecret, onComplete, sellerName, currentIndex, totalCount }: Props) {
  const formRef = useRef<HTMLDivElement>(null);
  // "loading" shows the shimmer, "leaving" fades it, "drawn" removes it.
  const [placeholder, setPlaceholder] = useState<"loading" | "leaving" | "drawn">("loading");
  // A new payment (next seller) starts with the shimmer again.
  const [placeholderSecret, setPlaceholderSecret] = useState(clientSecret);
  if (placeholderSecret !== clientSecret) {
    setPlaceholderSecret(clientSecret);
    setPlaceholder("loading");
  }

  useEffect(() => {
    const form = formRef.current;
    let done = false;
    let leaveTimer = 0;
    let observer: ResizeObserver | null = null;
    const markDrawn = () => {
      if (done) return;
      done = true;
      observer?.disconnect();
      setPlaceholder("leaving");
      leaveTimer = window.setTimeout(() => setPlaceholder("drawn"), 320);
    };
    const giveUpTimer = window.setTimeout(markDrawn, PLACEHOLDER_GIVE_UP_MS);
    if (form && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        if (form.offsetHeight >= STRIPE_FORM_DRAWN_PX) markDrawn();
      });
      observer.observe(form);
    }
    return () => {
      done = true;
      observer?.disconnect();
      window.clearTimeout(giveUpTimer);
      window.clearTimeout(leaveTimer);
    };
  }, [clientSecret]);

  if (!stripePromise) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
        Checkout is unavailable right now. Please try again later.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="pb-3 border-b border-neutral-100">
        <p className="text-sm font-medium text-neutral-900">{sellerName}</p>
        {totalCount > 1 && (
          <p className="text-xs text-neutral-500 mt-0.5">Payment {currentIndex} of {totalCount}</p>
        )}
      </div>
      <div className={`relative${placeholder === "drawn" ? "" : " min-h-[22rem]"}`}>
        {placeholder !== "drawn" && <CheckoutFormPlaceholder leaving={placeholder === "leaving"} />}
        <div ref={formRef} className="relative">
          <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret, onComplete }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    </div>
  );
}

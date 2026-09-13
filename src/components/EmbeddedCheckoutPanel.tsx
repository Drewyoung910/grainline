"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;

type Props = {
  clientSecret: string;
  onComplete: () => void;
  sellerName: string;
  currentIndex: number;
  totalCount: number;
};

export default function EmbeddedCheckoutPanel({ clientSecret, onComplete, sellerName, currentIndex, totalCount }: Props) {
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
      <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret, onComplete }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}

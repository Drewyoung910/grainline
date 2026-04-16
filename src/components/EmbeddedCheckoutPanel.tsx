"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

type Props = {
  clientSecret: string;
  onComplete: () => void;
  sellerName: string;
  currentIndex: number;
  totalCount: number;
};

export default function EmbeddedCheckoutPanel({ clientSecret, onComplete, sellerName, currentIndex, totalCount }: Props) {
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

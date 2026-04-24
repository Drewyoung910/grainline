"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ShippingAddressForm from "./ShippingAddressForm";
import ShippingRateSelector from "./ShippingRateSelector";
import EmbeddedCheckoutPanel from "./EmbeddedCheckoutPanel";
import GiftNoteSection from "./GiftNoteSection";
import type {
  ShippingAddress,
  SelectedShippingRate,
} from "@/types/checkout";

type ModalStep = "address" | "shipping" | "payment";

type Props = {
  listingId: string;
  listingTitle: string;
  listingImageUrl?: string;
  sellerName: string;
  sellerId: string;
  priceCents: number;
  quantity: number;
  offersGiftWrapping: boolean;
  giftWrappingPriceCents: number | null;
  selectedVariantOptionIds?: string[];
  isOpen: boolean;
  onClose: () => void;
  isSignedIn: boolean;
};

export default function BuyNowCheckoutModal({
  listingId,
  listingTitle,
  listingImageUrl,
  sellerName,
  sellerId,
  priceCents,
  quantity,
  offersGiftWrapping,
  giftWrappingPriceCents,
  selectedVariantOptionIds = [],
  isOpen,
  onClose,
  isSignedIn,
}: Props) {
  const router = useRouter();

  const [step, setStep] = useState<ModalStep>("address");
  const [shippingAddress, setShippingAddress] =
    useState<ShippingAddress | null>(null);
  const [selectedRate, setSelectedRate] =
    useState<SelectedShippingRate | null>(null);
  const [clientSecret, setClientSecret] =
    useState<string | null>(null);
  const [giftNote, setGiftNote] = useState("");
  const [giftWrapping, setGiftWrapping] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset payment/rate state when modal closes. Shipping rates are signed and
  // short-lived, so preserving selectedRate across re-open can create HMAC
  // failures even when the address did not change.
  useEffect(() => {
    if (!isOpen) {
      setClientSecret(null);
      setSelectedRate(null);
      setCreatingSession(false);
      setError(null);
      if (step === "payment") setStep("shipping");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  async function handleProceedToPayment() {
    if (!shippingAddress || !selectedRate) return;
    setCreatingSession(true);
    setError(null);
    try {
      const res = await fetch("/api/cart/checkout/single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId,
          quantity,
          shippingAddress,
          selectedRate,
          giftNote: giftNote || "",
          giftWrapping,
          selectedVariantOptionIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to create payment session");
      }
      setClientSecret(data.clientSecret);
      setStep("payment");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreatingSession(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-12 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-auto mb-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: item summary + close */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <div className="flex items-center gap-3 min-w-0">
            {listingImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={listingImageUrl}
                alt=""
                className="h-10 w-10 rounded-md object-cover flex-shrink-0 border border-neutral-200"
              />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-900 truncate">
                {listingTitle}
              </p>
              <p className="text-xs text-neutral-500">
                ${(priceCents / 100).toFixed(2)}
                {quantity > 1 && ` × ${quantity}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 ml-3 flex-shrink-0"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M15 5L5 15M5 5l10 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs px-5 pt-3 pb-1">
          {[
            { key: "address", label: "Address" },
            { key: "shipping", label: "Shipping" },
            { key: "payment", label: "Payment" },
          ].map((s, i) => (
            <span key={s.key} className="flex items-center gap-2">
              {i > 0 && <span className="text-neutral-300">→</span>}
              <span
                className={
                  step === s.key
                    ? "text-neutral-900 font-medium"
                    : "text-neutral-400"
                }
              >
                {s.label}
              </span>
            </span>
          ))}
        </div>

        {/* Step content */}
        <div className="px-5 pb-5 pt-3">
          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
              {error}
            </div>
          )}

          {/* Step 1: Address */}
          {step === "address" && (
            <ShippingAddressForm
              isSignedIn={isSignedIn}
              onConfirm={(address) => {
                setShippingAddress(address);
                setStep("shipping");
              }}
            />
          )}

          {/* Step 2: Shipping */}
          {step === "shipping" && shippingAddress && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-md bg-stone-50 border border-neutral-200 text-sm">
                <span className="text-neutral-600 truncate mr-3 text-xs">
                  <span className="font-medium text-neutral-900">
                    Delivering to:
                  </span>{" "}
                  {shippingAddress.line1}, {shippingAddress.city},{" "}
                  {shippingAddress.state} {shippingAddress.postalCode}
                </span>
                <button
                  onClick={() => {
                    setSelectedRate(null);
                    setStep("address");
                  }}
                  className="text-xs text-neutral-500 hover:text-neutral-700 whitespace-nowrap flex-shrink-0"
                >
                  Change
                </button>
              </div>

              <ShippingRateSelector
                sellerId={sellerId}
                sellerDisplayName={sellerName}
                address={shippingAddress}
                selectedRate={selectedRate}
                onSelect={setSelectedRate}
                quoteBodyExtra={{
                  mode: "single",
                  listingId,
                }}
              />

              {offersGiftWrapping && (
                <div className="pt-3 border-t border-neutral-100">
                  <GiftNoteSection
                    offersGiftWrapping={offersGiftWrapping}
                    giftWrappingPriceCents={giftWrappingPriceCents}
                    giftNote={giftNote}
                    giftWrapping={giftWrapping}
                    onChange={(note, wrapping) => {
                      setGiftNote(note);
                      setGiftWrapping(wrapping);
                    }}
                  />
                </div>
              )}

              {/* Order summary */}
              <div className="border border-neutral-200 rounded-lg p-4 space-y-2 text-sm bg-neutral-50">
                <div className="flex justify-between text-neutral-600">
                  <span>Items</span>
                  <span>${((priceCents * quantity) / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-neutral-600">
                  <span>Shipping</span>
                  <span>
                    {selectedRate ? (
                      selectedRate.amountCents === 0 ? (
                        "Free"
                      ) : (
                        `$${(selectedRate.amountCents / 100).toFixed(2)}`
                      )
                    ) : (
                      <span className="text-neutral-400 text-xs italic">
                        Calculating...
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-neutral-400">
                  <span>Tax</span>
                  <span>Calculated at payment</span>
                </div>
                {selectedRate && (
                  <div className="flex justify-between font-medium text-neutral-900 pt-2 border-t border-neutral-200 text-sm">
                    <span>Estimated total</span>
                    <span>
                      $
                      {(
                        (priceCents * quantity + selectedRate.amountCents) /
                        100
                      ).toFixed(2)}
                      +
                    </span>
                  </div>
                )}
              </div>

              <button
                onClick={handleProceedToPayment}
                disabled={!selectedRate || creatingSession}
                className="w-full rounded-md bg-neutral-900 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {creatingSession
                  ? "Preparing payment..."
                  : "Continue to payment →"}
              </button>

              <button
                onClick={() => setStep("address")}
                className="w-full text-sm text-neutral-500 hover:text-neutral-700"
              >
                ← Back to address
              </button>
            </div>
          )}

          {/* Step 3: Payment */}
          {step === "payment" && clientSecret && (
            <EmbeddedCheckoutPanel
              clientSecret={clientSecret}
              sellerName={sellerName}
              currentIndex={1}
              totalCount={1}
              onComplete={() => {
                // Extract session ID from clientSecret.
                // Format: cs_test_SESSIONID_secret_TOKEN
                // The part before "_secret_" is the session ID.
                const sessionId = clientSecret.split("_secret_")[0];
                router.push(
                  `/checkout/success?session_id=${sessionId}`,
                );
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

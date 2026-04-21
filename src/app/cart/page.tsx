// src/app/cart/page.tsx
"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import GiftNoteSection from "@/components/GiftNoteSection";
import ShippingAddressForm from "@/components/ShippingAddressForm";
import ShippingRateSelector from "@/components/ShippingRateSelector";
import EmbeddedCheckoutPanel from "@/components/EmbeddedCheckoutPanel";
import type { ShippingAddress, SelectedShippingRate } from "@/types/checkout";
import { isFallbackRate } from "@/types/checkout";

export default function CartPageWrapper() {
  return (
    <Suspense fallback={<main className="p-8">Loading…</main>}>
      <CartPage />
    </Suspense>
  );
}

type CartItem = {
  id: string;
  quantity: number;
  priceCents: number;
  listing: {
    id: string;
    title: string;
    sellerId: string;
    status?: string;
    sellerName?: string;
    sellerVacationMode?: boolean;
    photos?: { url: string }[];
    offersGiftWrapping?: boolean;
    giftWrappingPriceCents?: number | null;
  };
};

type Group = {
  sellerId: string;
  sellerName: string;
  items: CartItem[];
  subtotalCents: number;
};

type GiftForm = {
  giftNote: string;
  giftWrapping: boolean;
};

type CheckoutStep = "review" | "address" | "shipping" | "payment";

type ClientSecretEntry = {
  sellerId: string;
  sellerName: string;
  secret: string;
};

function CartPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [items, setItems] = React.useState<CartItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = React.useState(false);

  // per-seller gift state
  const [giftBySeller, setGiftBySeller] = React.useState<Record<string, GiftForm>>({});

  // Checkout step state
  const [step, setStep] = React.useState<CheckoutStep>("review");
  const [shippingAddress, setShippingAddress] = React.useState<ShippingAddress | null>(null);

  // Shipping rate selection per seller
  const [selectedRates, setSelectedRates] = React.useState<Record<string, SelectedShippingRate>>({});

  // Embedded checkout state
  const [clientSecrets, setClientSecrets] = React.useState<ClientSecretEntry[]>([]);
  const [currentPaymentIndex, setCurrentPaymentIndex] = React.useState(0);
  const [creatingSession, setCreatingSession] = React.useState(false);

  // Mount-time URL restoration
  React.useEffect(() => {
    const urlStep = searchParams.get("step");
    if (urlStep === "address") {
      setStep("address");
    } else if (urlStep === "shipping") {
      if (shippingAddress) {
        setStep("shipping");
      } else {
        setStep("address");
        router.replace("/cart?step=address", { scroll: false });
      }
    } else if (urlStep === "payment") {
      if (shippingAddress) {
        // Try restoring from sessionStorage
        try {
          const stored = sessionStorage.getItem("grainline_checkouts");
          if (stored) {
            const parsed = JSON.parse(stored) as ClientSecretEntry[];
            if (parsed.length > 0) {
              setClientSecrets(parsed);
              setStep("payment");
              return;
            }
          }
        } catch { /* ignore */ }
        setStep("shipping");
        router.replace("/cart?step=shipping", { scroll: false });
      } else {
        setStep("address");
        router.replace("/cart?step=address", { scroll: false });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Safety guards
  React.useEffect(() => {
    if (step === "shipping" && !shippingAddress) {
      setStep("address");
      router.replace("/cart?step=address", { scroll: false });
    }
    if (step === "payment" && (!shippingAddress || clientSecrets.length === 0)) {
      setStep("shipping");
      router.replace("/cart?step=shipping", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, shippingAddress, clientSecrets]);

  async function load() {
    setLoading(true);
    setError(null);
    setNeedsSignIn(false);
    try {
      const res = await fetch("/api/cart", { cache: "no-store" });
      if (res.status === 401) {
        setNeedsSignIn(true);
        setItems([]);
        return;
      }
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      setError("Failed to load cart");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function setQuantity(listingId: string, quantity: number) {
    setError(null);
    try {
      const res = await fetch("/api/cart/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId, quantity }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to update cart");
      await load();
      window.dispatchEvent(new Event("cart:updated"));
      // Reset checkout state on cart change
      sessionStorage.removeItem("grainline_checkouts");
      setClientSecrets([]);
      setCurrentPaymentIndex(0);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loading) return <main className="p-8">Loading…</main>;

  if (needsSignIn) {
    return (
      <main className="mx-auto max-w-2xl p-8 space-y-4">
        <h1 className="text-2xl font-semibold">Your cart</h1>
        <p>Please sign in to view your cart.</p>
        <Link href="/sign-in?redirect_url=/cart" className="inline-block rounded border px-3 py-1.5 text-sm">
          Sign in
        </Link>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-2xl p-8 space-y-4">
        <h1 className="text-2xl font-semibold">Your cart</h1>
        <p>Your cart is empty.</p>
        <a href="/browse" className="inline-block rounded border px-3 py-1.5 text-sm">
          Continue shopping
        </a>
      </main>
    );
  }

  // group by seller
  const groups: Group[] = Object.values(
    items.reduce((acc, it) => {
      const key = it.listing.sellerId;
      if (!acc[key]) {
        acc[key] = {
          sellerId: key,
          sellerName: it.listing.sellerName || "Seller",
          items: [],
          subtotalCents: 0,
        };
      }
      acc[key].items.push(it);
      acc[key].subtotalCents += it.priceCents * it.quantity;
      return acc;
    }, {} as Record<string, Group>)
  );

  const grandTotal = groups.reduce((s, g) => s + g.subtotalCents, 0);

  // Render seller item list (used in review and shipping steps)
  function renderSellerSections() {
    return groups.map((g) => (
      <section key={g.sellerId} className="rounded-lg border">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm text-neutral-700">
            <span className="text-neutral-500">Seller:</span>{" "}
            <span className="font-medium">{g.sellerName}</span>
          </div>
          <div className="text-sm">
            Subtotal: <span className="font-semibold">${(g.subtotalCents / 100).toFixed(2)}</span>
          </div>
        </header>

        <ul className="divide-y">
          {g.items.map((i) => {
            const img = i.listing.photos?.[0]?.url;
            const lineCents = i.priceCents * i.quantity;

            return (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className="h-16 w-16 rounded border object-cover" />
                ) : (
                  <div className="h-16 w-16 rounded border bg-neutral-100" />
                )}

                <div className="min-w-0 flex-1">
                  <a href={`/listing/${i.listing.id}`} className="block truncate text-sm font-medium hover:underline">
                    {i.listing.title}
                  </a>

                  {(i.listing.status && i.listing.status !== "ACTIVE") && (
                    <div className="text-xs text-red-600 mt-0.5">This item is no longer available</div>
                  )}
                  {i.listing.sellerVacationMode && (
                    <div className="text-xs text-amber-700 mt-0.5">Maker is on vacation</div>
                  )}

                  <div className="mt-1 flex items-center gap-3 text-sm text-neutral-700">
                    <span>${(i.priceCents / 100).toFixed(2)} each</span>

                    <label className="ml-2 text-xs text-neutral-500">Qty</label>
                    <select
                      className="rounded border px-2 py-1 text-sm"
                      value={i.quantity}
                      onChange={(e) => setQuantity(i.listing.id, Number(e.target.value))}
                    >
                      {Array.from({ length: 10 }).map((_, idx) => {
                        const n = idx + 1;
                        return (
                          <option key={n} value={n}>{n}</option>
                        );
                      })}
                    </select>

                    <button
                      type="button"
                      className="ml-2 text-xs text-red-600 underline"
                      onClick={() => setQuantity(i.listing.id, 0)}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="text-sm font-medium">
                  ${(lineCents / 100).toFixed(2)}
                </div>
              </li>
            );
          })}
        </ul>

        {/* Gift note */}
        <div className="px-4 py-3 border-t">
          <GiftNoteSection
            offersGiftWrapping={!!(g.items[0]?.listing.offersGiftWrapping)}
            giftWrappingPriceCents={g.items[0]?.listing.giftWrappingPriceCents ?? null}
            giftNote={giftBySeller[g.sellerId]?.giftNote ?? ""}
            giftWrapping={giftBySeller[g.sellerId]?.giftWrapping ?? false}
            onChange={(note, wrapping) =>
              setGiftBySeller((prev) => ({
                ...prev,
                [g.sellerId]: { giftNote: note, giftWrapping: wrapping },
              }))
            }
          />
        </div>
      </section>
    ));
  }

  // Calculate total shipping
  const totalShippingCents = groups.reduce((sum, g) => {
    const rate = selectedRates[g.sellerId];
    return sum + (rate ? rate.amountCents : 0);
  }, 0);

  const allRatesSelected = groups.every((g) => selectedRates[g.sellerId]);

  // Create checkout sessions for all sellers
  async function handleProceedToPayment() {
    if (!shippingAddress) return;
    setCreatingSession(true);
    setError(null);

    const secrets: ClientSecretEntry[] = [];
    try {
      for (const g of groups) {
        const rate = selectedRates[g.sellerId];
        if (!rate) throw new Error(`No shipping rate selected for ${g.sellerName}`);

        const gift = giftBySeller[g.sellerId];
        const giftWrappingPriceCents = g.items[0]?.listing.giftWrappingPriceCents ?? 0;

        const res = await fetch("/api/cart/checkout-seller", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sellerId: g.sellerId,
            shippingAddress,
            selectedRate: rate,
            giftNote: gift?.giftNote ?? "",
            giftWrapping: gift?.giftWrapping ?? false,
            giftWrappingPriceCents: gift?.giftWrapping ? (giftWrappingPriceCents ?? 0) : 0,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `Checkout failed for ${g.sellerName}`);
        secrets.push({
          sellerId: g.sellerId,
          sellerName: g.sellerName,
          secret: data.clientSecret,
        });
      }

      setClientSecrets(secrets);
      setCurrentPaymentIndex(0);
      sessionStorage.setItem("grainline_checkouts", JSON.stringify(secrets));
      setStep("payment");
      router.replace("/cart?step=payment", { scroll: false });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreatingSession(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Your cart</h1>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm mb-6">
        {[
          { key: "review", label: "Cart" },
          { key: "address", label: "Address" },
          { key: "shipping", label: "Shipping" },
          { key: "payment", label: "Payment" },
        ].map((s, i) => (
          <span key={s.key} className="flex items-center gap-2">
            {i > 0 && <span className="text-neutral-300">→</span>}
            <span className={
              step === s.key
                ? "text-neutral-900 font-medium"
                : "text-neutral-400"
            }>
              {s.label}
            </span>
          </span>
        ))}
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Step 1: Review */}
      {step === "review" && (() => {
        const hasUnavailable = items.some(
          (i) => (i.listing.status && i.listing.status !== "ACTIVE") || i.listing.sellerVacationMode
        );
        return (
        <>
          {renderSellerSections()}

          <div className="flex items-center justify-end gap-4">
            <div className="text-sm text-neutral-600">Grand total (items only)</div>
            <div className="text-lg font-semibold">${(grandTotal / 100).toFixed(2)}</div>
          </div>

          {hasUnavailable && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Some items in your cart are no longer available. Please remove them before continuing.
            </div>
          )}

          <button
            onClick={() => {
              setStep("address");
              router.replace("/cart?step=address", { scroll: false });
            }}
            disabled={items.length === 0 || hasUnavailable}
            className="w-full sm:w-auto rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 mt-6"
          >
            Continue to shipping →
          </button>
        </>
        );
      })()}

      {/* Step 2: Address */}
      {step === "address" && (
        <div className="max-w-lg mx-auto py-6">
          <h2 className="font-display text-2xl text-neutral-900 mb-6">
            Shipping address
          </h2>
          <ShippingAddressForm
            isSignedIn={!needsSignIn}
            onBack={() => {
              setStep("review");
              router.replace("/cart", { scroll: false });
            }}
            onConfirm={(address) => {
              setShippingAddress(address);
              setStep("shipping");
              router.replace("/cart?step=shipping", { scroll: false });
            }}
          />
        </div>
      )}

      {/* Step 3: Shipping */}
      {step === "shipping" && shippingAddress && (
        <>
          {/* Address summary */}
          <div className="flex items-center justify-between gap-4 mb-6 p-3 rounded-md bg-stone-50 border border-neutral-200">
            <p className="text-sm text-neutral-600">
              <span className="font-medium text-neutral-900">Delivering to:</span>{" "}
              {shippingAddress.name}, {shippingAddress.line1},{" "}
              {shippingAddress.city},{" "}
              {shippingAddress.state}{" "}
              {shippingAddress.postalCode}
            </p>
            <button
              onClick={() => {
                setSelectedRates({});
                setStep("address");
                router.replace("/cart?step=address", { scroll: false });
              }}
              className="text-sm text-neutral-500 hover:text-neutral-700 whitespace-nowrap flex-shrink-0"
            >
              Change
            </button>
          </div>

          <div className="flex flex-col lg:flex-row gap-8">
            {/* Shipping rate selectors */}
            <div className="flex-1 space-y-6">
              <h2 className="font-display text-xl text-neutral-900">Choose shipping</h2>
              {groups.map((g) => (
                <ShippingRateSelector
                  key={g.sellerId}
                  sellerId={g.sellerId}
                  sellerDisplayName={g.sellerName}
                  address={shippingAddress}
                  selectedRate={selectedRates[g.sellerId] ?? null}
                  onSelect={(rate) =>
                    setSelectedRates((prev) => ({ ...prev, [g.sellerId]: rate }))
                  }
                />
              ))}
            </div>

            {/* Order summary sidebar */}
            <div className="lg:w-72 space-y-4">
              <h3 className="text-sm font-medium text-neutral-900">Order summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-neutral-600">Items</span>
                  <span className="font-medium">${(grandTotal / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">Shipping</span>
                  <span className="font-medium">
                    {allRatesSelected
                      ? groups.some((g) => isFallbackRate(selectedRates[g.sellerId]))
                        ? "Calculated at checkout"
                        : `$${(totalShippingCents / 100).toFixed(2)}`
                      : "Selecting..."}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">Tax</span>
                  <span className="text-neutral-400">Calculated at checkout</span>
                </div>
                <hr />
                <div className="flex justify-between text-base">
                  <span className="text-neutral-900">Estimated total</span>
                  <span className="font-semibold">
                    {allRatesSelected && !groups.some((g) => isFallbackRate(selectedRates[g.sellerId]))
                      ? `$${((grandTotal + totalShippingCents) / 100).toFixed(2)}`
                      : `$${(grandTotal / 100).toFixed(2)}+`}
                  </span>
                </div>
              </div>

              <button
                onClick={handleProceedToPayment}
                disabled={!allRatesSelected || creatingSession}
                className="w-full rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {creatingSession ? "Preparing checkout..." : "Continue to payment →"}
              </button>

              <button
                onClick={() => {
                  setStep("address");
                  router.replace("/cart?step=address", { scroll: false });
                }}
                className="w-full text-sm text-neutral-500 hover:text-neutral-700"
              >
                ← Back to address
              </button>
            </div>
          </div>
        </>
      )}

      {/* Step 4: Payment */}
      {step === "payment" && clientSecrets.length > 0 && (
        <>
          {/* Address summary */}
          <div className="flex items-center justify-between gap-4 mb-6 p-3 rounded-md bg-stone-50 border border-neutral-200">
            <p className="text-sm text-neutral-600">
              <span className="font-medium text-neutral-900">Delivering to:</span>{" "}
              {shippingAddress?.name}, {shippingAddress?.line1},{" "}
              {shippingAddress?.city},{" "}
              {shippingAddress?.state}{" "}
              {shippingAddress?.postalCode}
            </p>
          </div>

          {currentPaymentIndex < clientSecrets.length ? (
            <EmbeddedCheckoutPanel
              key={clientSecrets[currentPaymentIndex].sellerId}
              clientSecret={clientSecrets[currentPaymentIndex].secret}
              sellerName={clientSecrets[currentPaymentIndex].sellerName}
              currentIndex={currentPaymentIndex + 1}
              totalCount={clientSecrets.length}
              onComplete={() => {
                if (currentPaymentIndex < clientSecrets.length - 1) {
                  setCurrentPaymentIndex((prev) => prev + 1);
                } else {
                  // All payments complete — clean up and redirect
                  sessionStorage.removeItem("grainline_checkouts");
                  const lastSecret = clientSecrets[clientSecrets.length - 1].secret;
                  const sessionId = lastSecret.split("_secret_")[0];
                  router.push(`/checkout/success?session_id=${sessionId}`);
                }
              }}
            />
          ) : (
            <div className="text-center py-8">
              <p className="text-neutral-600">All payments complete. Redirecting...</p>
            </div>
          )}

          <button
            onClick={() => {
              setStep("shipping");
              router.replace("/cart?step=shipping", { scroll: false });
            }}
            className="text-sm text-neutral-500 hover:text-neutral-700"
          >
            ← Back to shipping
          </button>
        </>
      )}
    </main>
  );
}

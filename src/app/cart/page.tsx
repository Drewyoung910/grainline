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
import {
  clearAnonymousCart,
  readAnonymousCartItems,
  updateAnonymousCartItem,
  writeAnonymousCartItems,
  type AnonymousCartItem,
} from "@/lib/anonymousCart";
import { notifyCartUpdated } from "@/lib/cartEvents";
import { signInPathForRedirect } from "@/lib/internalReturnUrl";
import { publicListingPath } from "@/lib/publicPaths";

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
  priceVersion?: number;
  livePriceCents?: number;
  livePriceVersion?: number;
  priceChanged?: boolean;
  variantUnavailable?: boolean;
  stockExceeded?: boolean;
  variantLabels?: string[];
  listing: {
    id: string;
    title: string;
    sellerId: string;
    currency?: string;
    listingType?: string;
    maxQuantity?: number;
    status?: string;
    sellerName?: string;
    sellerVacationMode?: boolean;
    sellerUnavailable?: boolean;
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
  sessionId: string;
};

const CART_ADDRESS_KEY = "grainline_cart_shipping_address";
const CART_RATES_KEY = "grainline_cart_selected_rates";
const CART_CHECKOUTS_KEY = "grainline_checkouts";

function readSessionJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeSessionJson(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* non-fatal */ }
}

function clearCheckoutStorage({ includeAddress = false }: { includeAddress?: boolean } = {}) {
  try {
    sessionStorage.removeItem(CART_CHECKOUTS_KEY);
    sessionStorage.removeItem(CART_RATES_KEY);
    if (includeAddress) sessionStorage.removeItem(CART_ADDRESS_KEY);
  } catch { /* non-fatal */ }
}

function sessionIdFromClientSecret(secret: string) {
  return secret.includes("_secret_") ? secret.split("_secret_")[0] : "";
}

function normalizeClientSecrets(entries: ClientSecretEntry[]) {
  return entries.flatMap((entry) => {
    const sessionId = entry.sessionId || sessionIdFromClientSecret(entry.secret);
    if (!entry.sellerId || !entry.sellerName || !entry.secret || !sessionId) return [];
    return [{ ...entry, sessionId }];
  });
}

function cartItemsFromAnonymous(items: AnonymousCartItem[]): CartItem[] {
  return items.map((item) => ({
    id: item.lineKey,
    quantity: item.quantity,
    priceCents: item.snapshot.priceCents,
    livePriceCents: item.snapshot.priceCents,
    livePriceVersion: 1,
    priceVersion: 1,
    priceChanged: false,
    variantUnavailable: false,
    stockExceeded: false,
    variantLabels: item.snapshot.variantLabels ?? [],
    listing: {
      id: item.listingId,
      title: item.snapshot.title,
      sellerId: item.snapshot.sellerId,
      currency: item.snapshot.currency ?? "usd",
      listingType: item.snapshot.listingType ?? undefined,
      maxQuantity: item.snapshot.listingType === "MADE_TO_ORDER"
        ? 1
        : Math.max(1, item.snapshot.maxQuantity ?? 99),
      status: "ACTIVE",
      sellerName: item.snapshot.sellerName,
      sellerVacationMode: false,
      sellerUnavailable: false,
      photos: item.snapshot.imageUrl ? [{ url: item.snapshot.imageUrl }] : [],
      offersGiftWrapping: !!item.snapshot.offersGiftWrapping,
      giftWrappingPriceCents: item.snapshot.giftWrappingPriceCents ?? null,
    },
  }));
}

async function mergeAnonymousCartIntoAccount(items: AnonymousCartItem[]): Promise<{
  mergedCount: number;
  rejectedCount: number;
  retryableFailure: boolean;
  errors: string[];
}> {
  let mergedCount = 0;
  let rejectedCount = 0;
  let retryableFailure = false;
  const errors: string[] = [];
  const retryableItems: AnonymousCartItem[] = [];

  for (const item of items) {
    try {
      const res = await fetch("/api/cart/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingId: item.listingId,
          quantity: item.quantity,
          selectedVariantOptionIds: item.selectedVariantOptionIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          retryableFailure = true;
          retryableItems.push(item);
          errors.push("Sign in again to restore your saved cart.");
          continue;
        }
        rejectedCount += 1;
        errors.push(data?.error || `${item.snapshot.title} could not be added to your cart.`);
        continue;
      }
      mergedCount += 1;
    } catch {
      retryableFailure = true;
      retryableItems.push(item);
      errors.push("Saved cart items could not be restored right now.");
    }
  }

  if (retryableFailure) {
    writeAnonymousCartItems(retryableItems);
  } else {
    clearAnonymousCart();
  }

  return { mergedCount, rejectedCount, retryableFailure, errors: [...new Set(errors)].slice(0, 3) };
}

async function rollbackCheckoutSessions(sessionIds: string[]) {
  const uniqueSessionIds = [...new Set(sessionIds.filter(Boolean))];
  if (uniqueSessionIds.length === 0) return;
  try {
    await fetch("/api/cart/checkout/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionIds: uniqueSessionIds }),
    });
  } catch {
    // Best effort; the Stripe expiration webhook is still a fallback.
  }
}

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
  const [rollingBackCheckout, setRollingBackCheckout] = React.useState(false);

  // Mount-time URL restoration
  React.useEffect(() => {
    const storedAddress = readSessionJson<ShippingAddress | null>(CART_ADDRESS_KEY, null);
    const storedSecrets = readSessionJson<ClientSecretEntry[]>(CART_CHECKOUTS_KEY, []);
    const normalizedStoredSecrets = normalizeClientSecrets(storedSecrets);
    const storedRatesRaw = readSessionJson<Record<string, SelectedShippingRate>>(CART_RATES_KEY, {});
    const validStoredRates = Object.fromEntries(
      Object.entries(storedRatesRaw).filter(([, rate]) => rate.expiresAt > Date.now() + 5000),
    );

    if (storedAddress) setShippingAddress(storedAddress);
    if (normalizedStoredSecrets.length > 0) {
      setClientSecrets(normalizedStoredSecrets);
      writeSessionJson(CART_CHECKOUTS_KEY, normalizedStoredSecrets);
    }
    if (Object.keys(validStoredRates).length > 0) setSelectedRates(validStoredRates);

    const urlStep = searchParams.get("step");
    if (urlStep === "address") {
      setStep("address");
    } else if (urlStep === "shipping") {
      if (storedAddress) {
        setStep("shipping");
      } else {
        setStep("address");
        router.replace("/cart?step=address", { scroll: false });
      }
    } else if (urlStep === "payment") {
      if (storedAddress) {
        if (normalizedStoredSecrets.length > 0) {
          setStep("payment");
          return;
        }
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
      const anonymousItems = readAnonymousCartItems();
      const res = await fetch("/api/cart", { cache: "no-store" });
      if (res.status === 401) {
        setNeedsSignIn(true);
        setItems(cartItemsFromAnonymous(anonymousItems));
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to load cart");
      }

      if (anonymousItems.length > 0) {
        const mergeResult = await mergeAnonymousCartIntoAccount(anonymousItems);
        if (mergeResult.retryableFailure) {
          setError(mergeResult.errors[0] ?? "Saved cart items could not be restored right now.");
        } else if (mergeResult.rejectedCount > 0) {
          setError(mergeResult.errors.join(" "));
        }
        if (mergeResult.mergedCount > 0 || mergeResult.rejectedCount > 0) {
          notifyCartUpdated();
        }

        const refreshed = await fetch("/api/cart", { cache: "no-store" });
        if (!refreshed.ok) {
          const data = await refreshed.json().catch(() => ({}));
          throw new Error(data?.error || "Failed to load cart");
        }
        const refreshedData = await refreshed.json();
        setItems(refreshedData.items || []);
        return;
      }

      const data = await res.json();
      setItems(data.items || []);
    } catch (e) {
      setError((e as Error).message || "Failed to load cart");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function setQuantity(cartItemId: string, quantity: number) {
    setError(null);
    if (needsSignIn) {
      const result = updateAnonymousCartItem(cartItemId, quantity);
      if (!result.ok) {
        setError("Could not update your saved cart in this browser.");
        return;
      }
      setItems(cartItemsFromAnonymous(result.items));
      notifyCartUpdated();
      clearCheckoutStorage();
      setSelectedRates({});
      setClientSecrets([]);
      setCurrentPaymentIndex(0);
      return;
    }

    try {
      const res = await fetch("/api/cart/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cartItemId, quantity }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to update cart");
      await load();
      notifyCartUpdated();
      // Reset checkout state on cart change
      clearCheckoutStorage();
      setSelectedRates({});
      setClientSecrets([]);
      setCurrentPaymentIndex(0);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function refreshChangedPrices() {
    const changedItems = items.filter((item) => item.priceChanged && !item.variantUnavailable);
    if (changedItems.length === 0) return;
    setError(null);
    try {
      for (const item of changedItems) {
        const res = await fetch("/api/cart/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cartItemId: item.id, quantity: item.quantity }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to refresh cart prices");
      }
      await load();
      notifyCartUpdated();
      clearCheckoutStorage();
      setSelectedRates({});
      setClientSecrets([]);
      setCurrentPaymentIndex(0);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loading) return <main className="p-8">Loading…</main>;

  if (needsSignIn && items.length === 0) {
    return (
      <main className="mx-auto max-w-2xl p-8 space-y-4">
        <h1 className="text-2xl font-semibold">Your cart</h1>
        <p>Your cart is empty.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/browse" className="inline-block rounded border px-3 py-1.5 text-sm">
            Continue shopping
          </Link>
          <Link href={signInPathForRedirect("/cart")} className="inline-block rounded border px-3 py-1.5 text-sm">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-2xl p-8 space-y-4">
        <h1 className="text-2xl font-semibold">Your cart</h1>
        <p>Your cart is empty.</p>
        <Link href="/browse" className="inline-block rounded border px-3 py-1.5 text-sm">
          Continue shopping
        </Link>
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
          sellerName: it.listing.sellerName || "Maker",
          items: [],
          subtotalCents: 0,
        };
      }
      acc[key].items.push(it);
      acc[key].subtotalCents += (it.livePriceCents ?? it.priceCents) * it.quantity;
      return acc;
    }, {} as Record<string, Group>)
  );

  const grandTotal = groups.reduce((s, g) => s + g.subtotalCents, 0);
  const hasUnavailable = items.some(
    (i) =>
      (i.listing.status && i.listing.status !== "ACTIVE") ||
      i.listing.sellerVacationMode ||
      i.listing.sellerUnavailable
  );
  const hasPriceChanged = items.some((i) => i.priceChanged && !i.variantUnavailable);
  const hasVariantUnavailable = items.some((i) => i.variantUnavailable);
  const hasStockExceeded = items.some((i) => i.stockExceeded);
  const hasMixedCurrencies = new Set(items.map((i) => (i.listing.currency || "usd").toLowerCase())).size > 1;
  const hasBlockingCartChange = hasUnavailable || hasPriceChanged || hasVariantUnavailable || hasStockExceeded || hasMixedCurrencies;

  // Render seller item list (used in review and shipping steps)
  function renderSellerSections() {
    return groups.map((g) => (
      <section key={g.sellerId} className="card-section">
        <header className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <div className="text-sm text-neutral-700">
            <span className="text-neutral-500">Maker:</span>{" "}
            <span className="font-medium">{g.sellerName}</span>
          </div>
          <div className="text-sm">
            Subtotal: <span className="font-semibold">${(g.subtotalCents / 100).toFixed(2)}</span>
          </div>
        </header>

        <ul className="divide-y divide-neutral-100">
          {g.items.map((i) => {
            const img = i.listing.photos?.[0]?.url;
            const unitPriceCents = i.livePriceCents ?? i.priceCents;
            const lineCents = unitPriceCents * i.quantity;
            const listingIsActive = !i.listing.status || i.listing.status === "ACTIVE";
            const quantitySelectId = `cart-quantity-${i.id}`;

            return (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className="h-16 w-16 rounded object-cover" />
                ) : (
                  <div className="h-16 w-16 rounded bg-neutral-100" />
                )}

                <div className="min-w-0 flex-1">
                  {listingIsActive ? (
                    <Link href={publicListingPath(i.listing.id, i.listing.title)} className="block truncate text-sm font-medium hover:underline">
                      {i.listing.title}
                    </Link>
                  ) : (
                    <span className="block truncate text-sm font-medium text-neutral-700">
                      {i.listing.title}
                    </span>
                  )}
                  {(i.variantLabels ?? []).length > 0 && (
                    <p className="text-xs text-neutral-500 mt-0.5">{(i.variantLabels ?? []).join(" · ")}</p>
                  )}

                  {!listingIsActive && (
                    <div className="text-xs text-red-600 mt-0.5">This item is no longer available</div>
                  )}
                  {i.listing.sellerVacationMode && (
                    <div className="text-xs text-amber-700 mt-0.5">Maker is on vacation</div>
                  )}
                  {i.listing.sellerUnavailable && !i.listing.sellerVacationMode && (
                    <div className="text-xs text-red-600 mt-0.5">This maker is not currently accepting orders</div>
                  )}
                  {i.variantUnavailable && (
                    <div className="text-xs text-red-600 mt-0.5">Selected options are no longer available</div>
                  )}
                  {i.stockExceeded && !i.variantUnavailable && (
                    <div className="text-xs text-red-600 mt-0.5">
                      {i.listing.maxQuantity && i.listing.maxQuantity > 0
                        ? `Only ${i.listing.maxQuantity} currently available`
                        : "This item is currently out of stock"}
                    </div>
                  )}

                  <div className="mt-1 flex items-center gap-2 flex-wrap text-sm text-neutral-700">
                    <span className="shrink-0">${(unitPriceCents / 100).toFixed(2)} each</span>
                    {i.priceChanged && !i.variantUnavailable && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                        Updated from ${(i.priceCents / 100).toFixed(2)}
                      </span>
                    )}

                    <label htmlFor={quantitySelectId} className="text-xs text-neutral-500 shrink-0">
                      Qty
                    </label>
                    <select
                      id={quantitySelectId}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-sm"
                      value={i.quantity}
                      onChange={(e) => setQuantity(i.id, Number(e.target.value))}
                    >
                      {Array.from({ length: Math.max(1, i.quantity, i.listing.maxQuantity ?? 99) }).map((_, idx) => {
                        const n = idx + 1;
                        return (
                          <option key={n} value={n}>{n}</option>
                        );
                      })}
                    </select>

                    <button
                      type="button"
                      className="inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-xs font-medium text-red-600 underline underline-offset-2 hover:bg-red-50"
                      onClick={() => setQuantity(i.id, 0)}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="text-sm font-medium shrink-0">
                  ${(lineCents / 100).toFixed(2)}
                </div>
              </li>
            );
          })}
        </ul>

        {/* Gift note */}
        <div className="px-4 py-3 border-t border-neutral-100">
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
  const totalGiftWrappingCents = groups.reduce((sum, g) => {
    if (!giftBySeller[g.sellerId]?.giftWrapping) return sum;
    return sum + (g.items[0]?.listing.giftWrappingPriceCents ?? 0);
  }, 0);

  const allRatesSelected = groups.every((g) => selectedRates[g.sellerId]);

  // Create checkout sessions for all sellers
  async function handleProceedToPayment() {
    if (!shippingAddress) return;
    if (hasBlockingCartChange) {
      setError("Review the changes in your cart before checking out.");
      setStep("review");
      router.replace("/cart", { scroll: false });
      return;
    }
    setCreatingSession(true);
    setError(null);

    const secrets: ClientSecretEntry[] = [];
    const openedSessionIds: string[] = [];
    try {
      for (const g of groups) {
        const rate = selectedRates[g.sellerId];
        if (!rate) throw new Error(`No shipping rate selected for ${g.sellerName}`);

        const gift = giftBySeller[g.sellerId];

        const res = await fetch("/api/cart/checkout-seller", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sellerId: g.sellerId,
            shippingAddress,
            selectedRate: rate,
            giftNote: gift?.giftNote ?? "",
            giftWrapping: gift?.giftWrapping ?? false,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data?.code === "PRICE_CHANGED") {
            await load();
            clearCheckoutStorage();
            setSelectedRates({});
            setClientSecrets([]);
            setCurrentPaymentIndex(0);
            setStep("review");
            router.replace("/cart", { scroll: false });
          }
          throw new Error(data?.error || `Checkout failed for ${g.sellerName}`);
        }
        const clientSecret = typeof data.clientSecret === "string" ? data.clientSecret : "";
        const sessionId = data.sessionId || sessionIdFromClientSecret(clientSecret);
        if (!clientSecret || !sessionId) {
          throw new Error(`Checkout failed for ${g.sellerName}`);
        }
        openedSessionIds.push(sessionId);
        secrets.push({
          sellerId: g.sellerId,
          sellerName: g.sellerName,
          secret: clientSecret,
          sessionId,
        });
      }

      setClientSecrets(secrets);
      setCurrentPaymentIndex(0);
      writeSessionJson(CART_CHECKOUTS_KEY, secrets);
      setStep("payment");
      router.replace("/cart?step=payment", { scroll: false });
    } catch (e) {
      if (openedSessionIds.length > 0) {
        await rollbackCheckoutSessions(openedSessionIds);
        clearCheckoutStorage();
        setClientSecrets([]);
        setCurrentPaymentIndex(0);
      }
      setError((e as Error).message);
    } finally {
      setCreatingSession(false);
    }
  }

  async function handleReturnToShippingFromPayment() {
    if (rollingBackCheckout) return;
    setRollingBackCheckout(true);
    setError(null);
    await rollbackCheckoutSessions(clientSecrets.map((entry) => entry.sessionId));
    clearCheckoutStorage();
    setClientSecrets([]);
    setCurrentPaymentIndex(0);
    setStep("shipping");
    router.replace("/cart?step=shipping", { scroll: false });
    setRollingBackCheckout(false);
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
                : "text-neutral-500"
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
        return (
          <>
            {renderSellerSections()}

            <div className="flex items-center justify-end gap-4">
              <div className="text-sm text-neutral-600">Subtotal (items only)</div>
              <div className="text-lg font-semibold">${(grandTotal / 100).toFixed(2)}</div>
            </div>

            {hasUnavailable && (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Some items in your cart are no longer available. Please remove them before continuing.
              </div>
            )}
            {hasVariantUnavailable && (
              <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Some selected options are no longer available. Please remove those items before continuing.
              </div>
            )}
            {hasStockExceeded && (
              <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Some quantities exceed current stock. Adjust those quantities before continuing.
              </div>
            )}
            {hasPriceChanged && (
              <div className="flex flex-col gap-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
                <span>Some prices changed since the items were added to your cart.</span>
                <button
                  type="button"
                  onClick={refreshChangedPrices}
                  className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                >
                  Accept updated prices
                </button>
              </div>
            )}
            {hasMixedCurrencies && (
              <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Items with different currencies cannot be checked out together. Please check out one currency at a time.
              </div>
            )}

            {needsSignIn && (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Sign in to keep these items and checkout.
              </div>
            )}

            {needsSignIn ? (
              <Link
                href={signInPathForRedirect("/cart")}
                className="inline-flex w-full items-center justify-center rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white hover:bg-neutral-800 sm:w-auto"
              >
                Sign in to checkout →
              </Link>
            ) : (
              <button
                onClick={() => {
                  setStep("address");
                  router.replace("/cart?step=address", { scroll: false });
                }}
                disabled={items.length === 0 || hasBlockingCartChange}
                className="w-full sm:w-auto rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 mt-6"
              >
                Continue to shipping →
              </button>
            )}
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
              writeSessionJson(CART_ADDRESS_KEY, address);
              clearCheckoutStorage();
              setSelectedRates({});
              setClientSecrets([]);
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
                clearCheckoutStorage();
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
                    setSelectedRates((prev) => {
                      const next = { ...prev };
                      if (rate) next[g.sellerId] = rate;
                      else delete next[g.sellerId];
                      writeSessionJson(CART_RATES_KEY, next);
                      return next;
                    })
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
                {groups.some((g) => giftBySeller[g.sellerId]?.giftWrapping) && (
                  <div className="flex justify-between text-sm text-neutral-600">
                    <span>Gift wrapping</span>
                    <span>
                      ${(totalGiftWrappingCents / 100).toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-neutral-600">Shipping</span>
                  <span className="font-medium">
                    {allRatesSelected
                      ? `$${(totalShippingCents / 100).toFixed(2)}`
                      : "Selecting..."}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">Tax</span>
                  <span className="text-neutral-500">Calculated at checkout</span>
                </div>
                <hr className="border-neutral-100" />
                <div className="flex justify-between text-base">
                  <span className="text-neutral-900">Estimated total</span>
                  <span className="font-semibold">
                    {allRatesSelected
                      ? `$${((grandTotal + totalShippingCents + totalGiftWrappingCents) / 100).toFixed(2)}`
                      : `$${((grandTotal + totalGiftWrappingCents) / 100).toFixed(2)}+`}
                  </span>
                </div>
              </div>

              <button
                onClick={handleProceedToPayment}
                disabled={!allRatesSelected || creatingSession || hasBlockingCartChange}
                className="w-full rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {creatingSession ? "Preparing checkout..." : "Continue to payment →"}
              </button>

              <button
                onClick={() => {
                  setSelectedRates({});
                  clearCheckoutStorage();
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
                  clearCheckoutStorage({ includeAddress: true });
                  const sessionIds = clientSecrets.map((entry) => entry.sessionId);
                  const params = new URLSearchParams({
                    session_id: sessionIds[sessionIds.length - 1],
                    session_ids: sessionIds.join(","),
                  });
                  router.push(`/checkout/success?${params.toString()}`);
                }
              }}
            />
          ) : (
            <div className="text-center py-8">
              <p className="text-neutral-600">All payments complete. Redirecting...</p>
            </div>
          )}

          <button
            onClick={handleReturnToShippingFromPayment}
            disabled={rollingBackCheckout}
            className="text-sm text-neutral-500 hover:text-neutral-700"
          >
            {rollingBackCheckout ? "Returning..." : "← Back to shipping"}
          </button>
        </>
      )}
    </main>
  );
}

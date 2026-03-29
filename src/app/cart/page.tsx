// src/app/cart/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import GiftNoteSection from "@/components/GiftNoteSection";

type CartItem = {
  id: string;
  quantity: number;
  priceCents: number;
  listing: {
    id: string;
    title: string;
    sellerId: string;
    sellerName?: string;
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

type DestForm = {
  useCalculated: boolean;
  postal: string;
  city: string;
  state: string;
  country: string;
};

type GiftForm = {
  giftNote: string;
  giftWrapping: boolean;
};

export default function CartPage() {
  const [items, setItems] = React.useState<CartItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [checkingOutSeller, setCheckingOutSeller] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = React.useState(false);

  // per-seller destination form state
  const [destBySeller, setDestBySeller] = React.useState<Record<string, DestForm>>({});
  // per-seller gift state
  const [giftBySeller, setGiftBySeller] = React.useState<Record<string, GiftForm>>({});

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

      // initialize dest forms for any new seller groups (don’t clobber if already typed)
      const groups = (data.items || []).reduce((set: Set<string>, it: CartItem) => {
        set.add(it.listing.sellerId);
        return set;
      }, new Set<string>());

      setDestBySeller((prev) => {
        const next = { ...prev };
        for (const sellerId of groups) {
          if (!next[sellerId]) {
            next[sellerId] = {
              useCalculated: false, // default off unless seller toggled on at profile, handled in API
              postal: "",
              city: "",
              state: "",
              country: "US",
            };
          }
        }
        return next;
      });
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
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function updateDest(sellerId: string, patch: Partial<DestForm>) {
    setDestBySeller((prev) => ({ ...prev, [sellerId]: { ...(prev[sellerId] || {}), ...patch } }));
  }

  async function checkoutSeller(sellerId: string) {
    setCheckingOutSeller(sellerId);
    setError(null);
    try {
      const dest = destBySeller[sellerId];
      const gift = giftBySeller[sellerId];
      const sellerGroup = groups.find((g) => g.sellerId === sellerId);
      const giftWrappingPriceCents = sellerGroup?.items[0]?.listing.giftWrappingPriceCents ?? 0;
      const body: Record<string, unknown> = {
        sellerId,
        giftNote: gift?.giftNote ?? "",
        giftWrapping: gift?.giftWrapping ?? false,
        giftWrappingPriceCents: gift?.giftWrapping ? (giftWrappingPriceCents ?? 0) : 0,
      };

      if (dest?.useCalculated) {
        body.useCalculated = true;
        // pass destination if present; ZIP/State/Country is enough for rating
        if (dest.postal)  body.toPostal = dest.postal.trim();
        if (dest.state)   body.toState  = dest.state.trim();
        if (dest.city)    body.toCity   = dest.city.trim();
        if (dest.country) body.toCountry = dest.country.trim() || "US";
      } else {
        body.useCalculated = false;
      }

      const res = await fetch("/api/cart/checkout-seller", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Checkout failed");
      window.location.href = data.url as string; // Stripe Checkout
    } catch (e) {
      setError((e as Error).message);
      setCheckingOutSeller(null);
    }
  }

  function planShippingAndTaxesNote() {
    return (
      <p className="text-xs text-neutral-500">
        Shipping &amp; taxes shown after you choose an option at Checkout.
      </p>
    );
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

  return (
    <main className="mx-auto max-w-3xl p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Your cart</h1>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {groups.map((g) => {
        const dest = destBySeller[g.sellerId] || {
          useCalculated: false,
          postal: "",
          city: "",
          state: "",
          country: "US",
        };
        const disabled = checkingOutSeller != null;

        return (
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

                      <div className="mt-1 flex items-center gap-3 text-sm text-neutral-700">
                        <span>${(i.priceCents / 100).toFixed(2)} each</span>

                        <label className="ml-2 text-xs text-neutral-500">Qty</label>
                        <select
                          className="rounded border px-2 py-1 text-sm"
                          value={i.quantity}
                          disabled={disabled}
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
                          className="ml-2 text-xs text-red-600 underline disabled:opacity-50"
                          onClick={() => setQuantity(i.listing.id, 0)}
                          disabled={disabled}
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

            {/* Destination + toggle */}
            <div className="px-4 py-3 border-t bg-neutral-50">
              <div className="flex items-center gap-3">
                <input
                  id={`calc-${g.sellerId}`}
                  type="checkbox"
                  className="h-4 w-4"
                  checked={dest.useCalculated}
                  disabled={disabled}
                  onChange={(e) => updateDest(g.sellerId, { useCalculated: e.target.checked })}
                />
                <label htmlFor={`calc-${g.sellerId}`} className="text-sm">
                  Use calculated shipping
                </label>
              </div>

              {dest.useCalculated && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2">
                  <input
                    className="rounded border px-2 py-1 text-sm col-span-2"
                    placeholder="ZIP / Postal *"
                    value={dest.postal}
                    onChange={(e) => updateDest(g.sellerId, { postal: e.target.value })}
                    disabled={disabled}
                  />
                  <input
                    className="rounded border px-2 py-1 text-sm"
                    placeholder="State/Region"
                    value={dest.state}
                    onChange={(e) => updateDest(g.sellerId, { state: e.target.value })}
                    disabled={disabled}
                  />
                  <input
                    className="rounded border px-2 py-1 text-sm"
                    placeholder="City"
                    value={dest.city}
                    onChange={(e) => updateDest(g.sellerId, { city: e.target.value })}
                    disabled={disabled}
                  />
                  <input
                    className="rounded border px-2 py-1 text-sm"
                    placeholder="Country"
                    value={dest.country}
                    onChange={(e) => updateDest(g.sellerId, { country: e.target.value })}
                    disabled={disabled}
                  />
                </div>
              )}
            </div>

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

            <footer className="flex flex-col items-end gap-2 px-4 py-3">
              {planShippingAndTaxesNote()}
              <button
                type="button"
                onClick={() => checkoutSeller(g.sellerId)}
                disabled={checkingOutSeller === g.sellerId}
                className="rounded bg-neutral-900 px-4 py-2 text-white text-sm disabled:opacity-50"
              >
                {checkingOutSeller === g.sellerId ? "Redirecting…" : "Checkout"}
              </button>
            </footer>
          </section>
        );
      })}

      <div className="flex items-center justify-end gap-4">
        <div className="text-sm text-neutral-600">Grand total (items only)</div>
        <div className="text-lg font-semibold">${(grandTotal / 100).toFixed(2)}</div>
      </div>

      <p className="text-xs text-neutral-500">
        You can check out each seller group separately. Calculated shipping quotes are based on the
        destination you enter above and verified after payment.
      </p>
    </main>
  );
}




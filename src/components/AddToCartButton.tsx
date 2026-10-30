"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { addAnonymousCartItem, type AnonymousCartSnapshot } from "@/lib/anonymousCart";
import { notifyCartUpdated } from "@/lib/cartEvents";
import { publicListingPath } from "@/lib/publicPaths";
import { signInPathForRedirect } from "@/lib/internalReturnUrl";
import { flyToCart } from "@/lib/flyToCart";

export default function AddToCartButton({
  listingId,
  listingTitle,
  signedIn,
  className = "",
  redirectToCart = false,
  selectedVariantOptionIds = [],
  variantRequired = false,
  anonymousSnapshot,
}: {
  listingId: string;
  listingTitle: string;
  signedIn: boolean;
  className?: string;
  redirectToCart?: boolean;
  selectedVariantOptionIds?: string[];
  variantRequired?: boolean;
  anonymousSnapshot?: AnonymousCartSnapshot;
}) {
  const [loading, setLoading] = React.useState(false);
  // Briefly confirms a successful add with a drawn check, then returns to
  // the normal label. Bumped on each add so the check redraws every time.
  const [addedCount, setAddedCount] = React.useState(0);
  const [showAdded, setShowAdded] = React.useState(false);
  const addedTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (addedTimerRef.current !== null) window.clearTimeout(addedTimerRef.current);
  }, []);
  const confirmAdded = () => {
    flyToCart();
    setAddedCount((count) => count + 1);
    setShowAdded(true);
    if (addedTimerRef.current !== null) window.clearTimeout(addedTimerRef.current);
    addedTimerRef.current = window.setTimeout(() => {
      setShowAdded(false);
      addedTimerRef.current = null;
    }, 1800);
  };
  const router = useRouter();
  // The toast sits at the bottom edge, clear of the photo flying to the
  // header bag, so it can show straight away.
  const showAddedToast = () => {
    toast("Added to your cart", "success", { action: { label: "View cart", onClick: () => router.push("/cart") } });
  };
  const { toast } = useToast();
  const listingPath = publicListingPath(listingId, listingTitle);

  async function add() {
    if (variantRequired && selectedVariantOptionIds.length === 0) {
      toast("Please select all variant options first.", "error");
      return;
    }
    if (!signedIn) {
      if (!anonymousSnapshot) {
        window.location.href = signInPathForRedirect(listingPath);
        return;
      }
      const result = addAnonymousCartItem({
        listingId,
        quantity: 1,
        selectedVariantOptionIds,
        snapshot: anonymousSnapshot,
      });
      if (!result.ok) {
        window.location.href = signInPathForRedirect(listingPath);
        return;
      }
      notifyCartUpdated();
      if (redirectToCart) {
        window.location.href = "/cart";
      } else {
        confirmAdded();
        showAddedToast();
      }
      return;
    }

    try {
      setLoading(true);
      const res = await fetch("/api/cart/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingId,
          quantity: 1,
          selectedVariantOptionIds,
        }),
      });
      const text = await res.text();
      let data: { error?: string; raw?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }
      if (!res.ok) throw new Error(data?.error || "Failed to add to cart");
      notifyCartUpdated();
      if (redirectToCart) {
        window.location.href = "/cart";
      } else {
        confirmAdded();
        showAddedToast();
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      disabled={loading}
      onClick={add}
      className={className || "rounded border px-3 py-1.5 text-sm"}
    >
      {loading ? (
        "Adding…"
      ) : showAdded ? (
        <span key={addedCount} className="inline-flex items-center justify-center gap-2">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="check-draw h-[18px] w-[18px]"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
          </svg>
          Added
        </span>
      ) : (
        "Add to cart"
      )}
    </button>
  );
}

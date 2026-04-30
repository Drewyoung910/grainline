"use client";

import * as React from "react";
import { useToast } from "@/components/Toast";
import { addAnonymousCartItem, type AnonymousCartSnapshot } from "@/lib/anonymousCart";
import { notifyCartUpdated } from "@/lib/cartEvents";
import { publicListingPath } from "@/lib/publicPaths";
import { signInPathForRedirect } from "@/lib/internalReturnUrl";

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
        toast("Added to cart!", "success");
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
        toast("Added to cart!", "success");
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
      {loading ? "Adding…" : "Add to cart"}
    </button>
  );
}

"use client";

import * as React from "react";
import { useToast } from "@/components/Toast";

export default function AddToCartButton({
  listingId,
  signedIn,
  className = "",
  redirectToCart = false,
  selectedVariantOptionIds = [],
  variantRequired = false,
}: {
  listingId: string;
  signedIn: boolean;
  className?: string;
  redirectToCart?: boolean;
  selectedVariantOptionIds?: string[];
  variantRequired?: boolean;
}) {
  const [loading, setLoading] = React.useState(false);
  const { toast } = useToast();

  async function add() {
    if (variantRequired && selectedVariantOptionIds.length === 0) {
      toast("Please select all variant options first.", "error");
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
      window.dispatchEvent(new Event("cart:updated"));
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

  if (!signedIn) {
    return (
      <a
        href={`/sign-in?redirect_url=${encodeURIComponent(`/listing/${listingId}`)}`}
        className={className || "rounded border px-3 py-1.5 text-sm"}
      >
        Sign in to add
      </a>
    );
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




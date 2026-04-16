"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import BuyNowCheckoutModal from "./BuyNowCheckoutModal";

type Props = {
  listingId: string;
  listingTitle: string;
  listingImageUrl?: string;
  sellerName: string;
  sellerId: string;
  priceCents: number;
  quantity?: number;
  offersGiftWrapping?: boolean;
  giftWrappingPriceCents?: number | null;
  className?: string;
  children?: React.ReactNode;
};

export default function BuyNowButton({
  listingId,
  listingTitle,
  listingImageUrl,
  sellerName,
  sellerId,
  priceCents,
  quantity = 1,
  offersGiftWrapping = false,
  giftWrappingPriceCents = null,
  className = "",
  children,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const { isSignedIn, isLoaded } = useUser();

  return (
    <>
      <button
        type="button"
        disabled={!isLoaded}
        onClick={() => {
          // Gate before opening modal — saves buyer from
          // completing address + shipping only to hit 401
          if (!isSignedIn) {
            window.location.href = `/sign-in?redirect_url=${encodeURIComponent(
              window.location.pathname,
            )}`;
            return;
          }
          setIsOpen(true);
        }}
        className={
          className ||
          "rounded bg-black px-4 py-2 text-white text-sm disabled:opacity-50"
        }
      >
        {children ?? "Buy now"}
      </button>

      <BuyNowCheckoutModal
        listingId={listingId}
        listingTitle={listingTitle}
        listingImageUrl={listingImageUrl}
        sellerName={sellerName}
        sellerId={sellerId}
        priceCents={priceCents}
        quantity={quantity}
        offersGiftWrapping={offersGiftWrapping}
        giftWrappingPriceCents={giftWrappingPriceCents}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        isSignedIn={isSignedIn ?? false}
      />
    </>
  );
}

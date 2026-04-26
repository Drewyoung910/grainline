"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useToast } from "@/components/Toast";
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
  selectedVariantOptionIds?: string[];
  variantRequired?: boolean;
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
  selectedVariantOptionIds = [],
  variantRequired = false,
  className = "",
  children,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const { isSignedIn, isLoaded } = useUser();
  const { toast } = useToast();

  return (
    <>
      <button
        type="button"
        disabled={!isLoaded}
        onClick={() => {
          if (variantRequired && selectedVariantOptionIds.length === 0) {
            toast("Please select all variant options first.", "error");
            return;
          }
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
          "inline-flex min-h-11 items-center justify-center rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
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
        selectedVariantOptionIds={selectedVariantOptionIds}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        isSignedIn={isSignedIn ?? false}
      />
    </>
  );
}

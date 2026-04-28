"use client";

import { useState, useCallback } from "react";
import VariantSelector, { type VariantGroupForSelector } from "./VariantSelector";
import BuyNowButton from "./BuyNowButton";
import AddToCartButton from "./AddToCartButton";
import NotifyMeButton from "./NotifyMeButton";
import { Gift } from "./icons";
import { publicListingPath } from "@/lib/publicPaths";

export default function ListingPurchasePanel({
  basePriceCents,
  variantGroups,
  listingId,
  listingTitle,
  listingImageUrl,
  sellerId,
  sellerName,
  userId,
  canBuy,
  isActive,
  isOwnListing,
  isOutOfStock,
  isNotified,
  listingType,
  stockQuantity,
  processingLabel,
  offersGiftWrapping,
  giftWrappingPriceCents,
  ratingDisplay,
  ratingCount,
}: {
  basePriceCents: number;
  variantGroups: VariantGroupForSelector[];
  listingId: string;
  listingTitle: string;
  listingImageUrl?: string;
  sellerId: string;
  sellerName: string;
  userId: string | null;
  canBuy: boolean;
  isActive: boolean;
  isOwnListing: boolean;
  isOutOfStock: boolean;
  isNotified: boolean;
  listingType: string;
  stockQuantity: number | null;
  processingLabel: string | null;
  offersGiftWrapping: boolean;
  giftWrappingPriceCents: number | null;
  ratingDisplay: string | null;
  ratingCount: number;
}) {
  const hasVariants = variantGroups.length > 0;
  const [totalPriceCents, setTotalPriceCents] = useState(basePriceCents);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const variantRequired = hasVariants;
  const listingPath = publicListingPath(listingId, listingTitle);

  const handleSelectionChange = useCallback(
    (ids: string[], price: number) => {
      setSelectedOptionIds(ids);
      setTotalPriceCents(price);
    },
    []
  );

  return (
    <div className="space-y-4">
      {/* Price + rating */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-3xl font-semibold">
          ${(totalPriceCents / 100).toFixed(2)}
          {hasVariants && totalPriceCents !== basePriceCents && (
            <span className="text-base font-normal text-neutral-400 ml-2 line-through">
              ${(basePriceCents / 100).toFixed(2)}
            </span>
          )}
        </div>
        {ratingDisplay && ratingCount > 0 && (
          <a href="#reviews" className="flex items-center gap-1.5 group">
            <span className="text-sm text-neutral-700 group-hover:underline">
              {ratingDisplay} <span className="text-neutral-400">({ratingCount})</span>
            </span>
          </a>
        )}
      </div>

      {/* Variant selector */}
      {hasVariants && (
        <VariantSelector
          groups={variantGroups}
          basePriceCents={basePriceCents}
          onSelectionChange={handleSelectionChange}
        />
      )}

      {/* Stock status */}
      {listingType === "IN_STOCK" ? (
        isOutOfStock ? (
          <div className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-full px-3 py-1 text-sm font-medium text-red-700">
            Out of Stock
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-full px-3 py-1 text-sm font-medium text-green-700">
            {stockQuantity != null ? `In Stock · ${stockQuantity} available` : "In Stock"}
          </div>
        )
      ) : (
        <div className="inline-flex items-center gap-1.5 bg-neutral-100 border border-neutral-200 rounded-full px-3 py-1 text-sm font-medium text-neutral-700">
          Made to order
        </div>
      )}

      {processingLabel && (
        <p className="text-sm text-neutral-600">{processingLabel}</p>
      )}

      {/* Notify when back in stock */}
      {isActive && !isOwnListing && isOutOfStock && (
        <NotifyMeButton
          listingId={listingId}
          listingTitle={listingTitle}
          initialSubscribed={isNotified}
          signedIn={!!userId}
        />
      )}

      {/* Buy buttons */}
      {canBuy && (
        <div className="flex flex-col gap-2">
          {userId ? (
            <BuyNowButton
              listingId={listingId}
              listingTitle={listingTitle}
              listingImageUrl={listingImageUrl}
              sellerName={sellerName}
              sellerId={sellerId}
              priceCents={totalPriceCents}
              offersGiftWrapping={offersGiftWrapping}
              giftWrappingPriceCents={giftWrappingPriceCents}
              selectedVariantOptionIds={selectedOptionIds}
              variantRequired={variantRequired}
              className="w-full rounded-md bg-neutral-900 px-4 py-3 text-white text-sm font-medium min-h-[48px] hover:bg-neutral-700 transition-colors"
            >
              Buy now
            </BuyNowButton>
          ) : (
            <a
              href={`/sign-in?redirect_url=${encodeURIComponent(listingPath)}`}
              className="w-full rounded-md bg-neutral-900 px-4 py-3 text-white text-sm font-medium min-h-[48px] text-center flex items-center justify-center hover:bg-neutral-700 transition-colors"
            >
              Sign in to buy
            </a>
          )}
          <AddToCartButton
            listingId={listingId}
            listingTitle={listingTitle}
            signedIn={!!userId}
            selectedVariantOptionIds={selectedOptionIds}
            variantRequired={variantRequired}
            className="w-full rounded-md border border-neutral-300 px-4 py-3 text-sm font-medium min-h-[48px] hover:bg-neutral-50 transition-colors"
          />
        </div>
      )}

      {/* Gift wrapping */}
      {offersGiftWrapping && canBuy && (
        <p className="text-xs text-neutral-500 flex items-center gap-1">
          <Gift size={13} className="text-neutral-400" /> Gift wrapping available
          {giftWrappingPriceCents
            ? ` · $${(giftWrappingPriceCents / 100).toFixed(2)}`
            : ""}
        </p>
      )}
    </div>
  );
}

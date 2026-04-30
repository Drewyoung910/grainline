"use client";

import { useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import VariantSelector, { type VariantGroupForSelector } from "./VariantSelector";
import BuyNowButton from "./BuyNowButton";
import AddToCartButton from "./AddToCartButton";
import NotifyMeButton from "./NotifyMeButton";
import { Gift } from "./icons";
import { publicListingPath } from "@/lib/publicPaths";
import { signUpPathForRedirect } from "@/lib/internalReturnUrl";
import { useToast } from "@/components/Toast";

function selectedOptionIdsFromIntent(groups: VariantGroupForSelector[], rawValue: string | null) {
  if (!rawValue) return [];
  const requested = new Set(rawValue.split(",").map((id) => id.trim()).filter(Boolean));
  const selected: string[] = [];
  for (const group of groups) {
    const option = group.options.find((opt) => requested.has(opt.id) && opt.inStock);
    if (option) selected.push(option.id);
  }
  return selected;
}

function priceForSelectedOptions(groups: VariantGroupForSelector[], basePriceCents: number, selectedOptionIds: string[]) {
  const selected = new Set(selectedOptionIds);
  const adjustment = groups.reduce((sum, group) => {
    const option = group.options.find((opt) => selected.has(opt.id));
    return sum + (option?.priceAdjustCents ?? 0);
  }, 0);
  return basePriceCents + adjustment;
}

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
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const hasVariants = variantGroups.length > 0;
  const intentSelectedOptionIds = useMemo(
    () => selectedOptionIdsFromIntent(variantGroups, searchParams.get("variant_options")),
    [searchParams, variantGroups],
  );
  const initialPriceCents = useMemo(
    () => priceForSelectedOptions(variantGroups, basePriceCents, intentSelectedOptionIds),
    [basePriceCents, intentSelectedOptionIds, variantGroups],
  );
  const [totalPriceCents, setTotalPriceCents] = useState(initialPriceCents);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>(intentSelectedOptionIds);
  const variantRequired = hasVariants;
  const variantSelectionComplete = !variantRequired || selectedOptionIds.length === variantGroups.length;
  const selectedVariantLabels = useMemo(() => {
    const selected = new Set(selectedOptionIds);
    return variantGroups.flatMap((group) => {
      const option = group.options.find((opt) => selected.has(opt.id));
      return option ? [`${group.name}: ${option.label}`] : [];
    });
  }, [selectedOptionIds, variantGroups]);
  const listingPath = publicListingPath(listingId, listingTitle);
  const buyNowRedirectPath = useMemo(() => {
    const url = new URL(listingPath, "https://thegrainline.com");
    url.searchParams.set("buy_now", "1");
    if (selectedOptionIds.length > 0) {
      url.searchParams.set("variant_options", selectedOptionIds.join(","));
    }
    return `${url.pathname}${url.search}`;
  }, [listingPath, selectedOptionIds]);
  const shouldAutoOpenBuyNow = userId != null && searchParams.get("buy_now") === "1" && variantSelectionComplete;

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
            <span className="text-base font-normal text-neutral-500 ml-2 line-through">
              ${(basePriceCents / 100).toFixed(2)}
            </span>
          )}
        </div>
        {ratingDisplay && ratingCount > 0 && (
          <a href="#reviews" className="flex items-center gap-1.5 group">
            <span className="text-sm text-neutral-700 group-hover:underline">
              {ratingDisplay} <span className="text-neutral-500">({ratingCount})</span>
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
          initialSelectedOptionIds={intentSelectedOptionIds}
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
              autoOpen={shouldAutoOpenBuyNow}
              className="w-full rounded-md bg-neutral-900 px-4 py-3 text-white text-sm font-medium min-h-[48px] hover:bg-neutral-700 transition-colors"
            >
              Buy now
            </BuyNowButton>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!variantSelectionComplete) {
                  toast("Please select all variant options first.", "error");
                  return;
                }
                window.location.href = signUpPathForRedirect(buyNowRedirectPath);
              }}
              className="w-full rounded-md bg-neutral-900 px-4 py-3 text-white text-sm font-medium min-h-[48px] text-center flex items-center justify-center hover:bg-neutral-700 transition-colors"
            >
              Sign up to buy
            </button>
          )}
          <AddToCartButton
            listingId={listingId}
            listingTitle={listingTitle}
            signedIn={!!userId}
            selectedVariantOptionIds={selectedOptionIds}
            variantRequired={variantRequired}
            anonymousSnapshot={{
              title: listingTitle,
              sellerId,
              sellerName,
              priceCents: totalPriceCents,
              imageUrl: listingImageUrl ?? null,
              variantLabels: selectedVariantLabels,
              listingType,
              currency: "usd",
              maxQuantity: listingType === "MADE_TO_ORDER" ? 1 : stockQuantity,
              offersGiftWrapping,
              giftWrappingPriceCents,
            }}
            className="w-full rounded-md border border-neutral-300 px-4 py-3 text-sm font-medium min-h-[48px] hover:bg-neutral-50 transition-colors"
          />
        </div>
      )}

      {/* Gift wrapping */}
      {offersGiftWrapping && canBuy && (
        <p className="text-xs text-neutral-500 flex items-center gap-1">
          <Gift size={13} className="text-neutral-500" /> Gift wrapping available
          {giftWrappingPriceCents
            ? ` · $${(giftWrappingPriceCents / 100).toFixed(2)}`
            : ""}
        </p>
      )}
    </div>
  );
}

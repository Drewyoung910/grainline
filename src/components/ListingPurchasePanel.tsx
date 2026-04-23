"use client";

import { useState, useCallback } from "react";
import VariantSelector, { type VariantGroupForSelector } from "./VariantSelector";

/**
 * Client wrapper for the listing detail purchase panel.
 * Manages variant selection state and live price display.
 * Children receive selectedOptionIds and totalPriceCents via render prop.
 */
export default function ListingPurchasePanel({
  basePriceCents,
  variantGroups,
  children,
}: {
  basePriceCents: number;
  variantGroups: VariantGroupForSelector[];
  children: (ctx: {
    totalPriceCents: number;
    selectedOptionIds: string[];
    allVariantsSelected: boolean;
  }) => React.ReactNode;
}) {
  const hasVariants = variantGroups.length > 0;
  const [totalPriceCents, setTotalPriceCents] = useState(basePriceCents);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);

  const allVariantsSelected = !hasVariants || selectedOptionIds.length === variantGroups.length;

  const handleSelectionChange = useCallback(
    (ids: string[], price: number) => {
      setSelectedOptionIds(ids);
      setTotalPriceCents(price);
    },
    []
  );

  return (
    <div className="space-y-4">
      {/* Live price */}
      <div className="text-3xl font-semibold">
        ${(totalPriceCents / 100).toFixed(2)}
        {hasVariants && totalPriceCents !== basePriceCents && (
          <span className="text-base font-normal text-neutral-400 ml-2 line-through">
            ${(basePriceCents / 100).toFixed(2)}
          </span>
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

      {/* Render children with context */}
      {children({ totalPriceCents, selectedOptionIds, allVariantsSelected })}
    </div>
  );
}

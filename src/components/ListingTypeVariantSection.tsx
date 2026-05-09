"use client";

import * as React from "react";
import ListingTypeFields from "@/components/ListingTypeFields";
import VariantEditor, { type VariantGroupData } from "@/components/VariantEditor";

export default function ListingTypeVariantSection({
  listingType = "MADE_TO_ORDER",
  minDays,
  maxDays,
  stockQuantity,
  shipsWithinDays,
  category,
  initialVariantGroups = [],
}: {
  listingType?: "MADE_TO_ORDER" | "IN_STOCK";
  minDays?: number | null;
  maxDays?: number | null;
  stockQuantity?: number | null;
  shipsWithinDays?: number | null;
  category?: string | null;
  initialVariantGroups?: VariantGroupData[];
}) {
  const [type, setType] = React.useState<"MADE_TO_ORDER" | "IN_STOCK">(listingType);

  return (
    <>
      <div className="card-section p-4">
        <div className="text-sm font-medium text-neutral-700 mb-2">Listing type</div>
        <ListingTypeFields
          listingType={type}
          minDays={minDays}
          maxDays={maxDays}
          stockQuantity={stockQuantity}
          shipsWithinDays={shipsWithinDays}
          category={category}
          onListingTypeChange={setType}
        />
      </div>

      <div className="card-section p-4">
        <VariantEditor initialGroups={initialVariantGroups} listingType={type} />
      </div>
    </>
  );
}

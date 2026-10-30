"use client";

import * as React from "react";
import ListingTypeFields from "@/components/ListingTypeFields";
import VariantEditor, { type VariantGroupData } from "@/components/VariantEditor";

export default function ListingTypeVariantSection({
  listingType = "MADE_TO_ORDER",
  minDays,
  maxDays,
  stockQuantity,
  stockQuantityEditor,
  shipsWithinDays,
  category,
  initialVariantGroups = [],
}: {
  listingType?: "MADE_TO_ORDER" | "IN_STOCK";
  minDays?: number | null;
  maxDays?: number | null;
  stockQuantity?: number | null;
  stockQuantityEditor?: React.ReactNode;
  shipsWithinDays?: number | null;
  category?: string | null;
  initialVariantGroups?: VariantGroupData[];
}) {
  const [type, setType] = React.useState<"MADE_TO_ORDER" | "IN_STOCK">(listingType);

  return (
    <>
      {/* ListingTypeFields labels its own Category and Listing type fields, so
          the card carries no extra "Listing type" heading above Category. */}
      <div className="card-section p-4">
        <ListingTypeFields
          listingType={type}
          minDays={minDays}
          maxDays={maxDays}
          stockQuantity={stockQuantity}
          stockQuantityEditor={stockQuantityEditor}
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

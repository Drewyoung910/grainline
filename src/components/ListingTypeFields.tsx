// src/components/ListingTypeFields.tsx
"use client";
import * as React from "react";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";

export default function ListingTypeFields({
  listingType = "MADE_TO_ORDER",
  minDays,
  maxDays,
  stockQuantity,
  shipsWithinDays,
  category,
}: {
  listingType?: "MADE_TO_ORDER" | "IN_STOCK";
  minDays?: number | null;
  maxDays?: number | null;
  stockQuantity?: number | null;
  shipsWithinDays?: number | null;
  category?: string | null;
}) {
  const [type, setType] = React.useState<"MADE_TO_ORDER" | "IN_STOCK">(listingType);

  return (
    <div className="space-y-3">
      {/* Category */}
      <div>
        <label className="block text-sm font-medium mb-1">Category</label>
        <select
          name="category"
          defaultValue={category ?? ""}
          className="w-full rounded border px-3 py-2 text-sm"
        >
          <option value="">— Select a category —</option>
          {CATEGORY_VALUES.map((v) => (
            <option key={v} value={v}>
              {CATEGORY_LABELS[v]}
            </option>
          ))}
        </select>
      </div>

      {/* Listing type */}
      <div className="flex gap-6">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name="listingType"
            value="MADE_TO_ORDER"
            checked={type === "MADE_TO_ORDER"}
            onChange={() => setType("MADE_TO_ORDER")}
          />
          Made to Order
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name="listingType"
            value="IN_STOCK"
            checked={type === "IN_STOCK"}
            onChange={() => setType("IN_STOCK")}
          />
          In Stock
        </label>
      </div>

      {type === "MADE_TO_ORDER" && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-neutral-500">Processing time (days)</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="mb-1">Min days</div>
              <input
                name="processingTimeMinDays"
                type="number"
                step="1"
                min="1"
                placeholder="1"
                defaultValue={minDays ?? ""}
                className="w-full rounded border px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1">Max days</div>
              <input
                name="processingTimeMaxDays"
                type="number"
                step="1"
                min="1"
                placeholder="7"
                defaultValue={maxDays ?? ""}
                className="w-full rounded border px-3 py-2"
              />
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            How long you need to prepare the item before shipping. Buyers see this on your listing.
          </p>
        </div>
      )}

      {type === "IN_STOCK" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="mb-1">Quantity in stock</div>
              <input
                name="stockQuantity"
                type="number"
                step="1"
                min="1"
                placeholder="1"
                defaultValue={stockQuantity ?? 1}
                className="w-full rounded border px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1">Ships within (days)</div>
              <input
                name="shipsWithinDays"
                type="number"
                step="1"
                min="1"
                placeholder="3"
                defaultValue={shipsWithinDays ?? ""}
                className="w-full rounded border px-3 py-2"
              />
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            Quantity available and how quickly you ship in-stock items. Buyers see both on your listing.
          </p>
        </div>
      )}
    </div>
  );
}

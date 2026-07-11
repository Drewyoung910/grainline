// src/components/ListingTypeFields.tsx
"use client";
import * as React from "react";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import { MAX_MANUAL_STOCK_QUANTITY } from "@/lib/stockMutationState";

export default function ListingTypeFields({
  listingType = "MADE_TO_ORDER",
  minDays,
  maxDays,
  stockQuantity,
  shipsWithinDays,
  category,
  onListingTypeChange,
}: {
  listingType?: "MADE_TO_ORDER" | "IN_STOCK";
  minDays?: number | null;
  maxDays?: number | null;
  stockQuantity?: number | null;
  shipsWithinDays?: number | null;
  category?: string | null;
  onListingTypeChange?: (type: "MADE_TO_ORDER" | "IN_STOCK") => void;
}) {
  const [type, setType] = React.useState<"MADE_TO_ORDER" | "IN_STOCK">(listingType);
  const listingTypeLabelId = React.useId();
  const madeToOrderRef = React.useRef<HTMLButtonElement>(null);
  const inStockRef = React.useRef<HTMLButtonElement>(null);

  function changeType(nextType: "MADE_TO_ORDER" | "IN_STOCK") {
    setType(nextType);
    onListingTypeChange?.(nextType);
  }

  function focusType(nextType: "MADE_TO_ORDER" | "IN_STOCK") {
    const target = nextType === "MADE_TO_ORDER" ? madeToOrderRef : inStockRef;
    requestAnimationFrame(() => target.current?.focus());
  }

  function handleListingTypeKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentType: "MADE_TO_ORDER" | "IN_STOCK",
  ) {
    let nextType: "MADE_TO_ORDER" | "IN_STOCK" | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextType = currentType === "MADE_TO_ORDER" ? "IN_STOCK" : "MADE_TO_ORDER";
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextType = currentType === "IN_STOCK" ? "MADE_TO_ORDER" : "IN_STOCK";
    } else if (event.key === "Home") {
      nextType = "MADE_TO_ORDER";
    } else if (event.key === "End") {
      nextType = "IN_STOCK";
    }
    if (!nextType) return;

    event.preventDefault();
    changeType(nextType);
    focusType(nextType);
  }

  return (
    <div className="space-y-4">
      {/* Category */}
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Category</label>
        <select
          name="category"
          defaultValue={category ?? ""}
          className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm"
        >
          <option value="">-- Select a category --</option>
          {CATEGORY_VALUES.map((v) => (
            <option key={v} value={v}>
              {CATEGORY_LABELS[v]}
            </option>
          ))}
        </select>
      </div>

      {/* Listing type */}
      <div role="radiogroup" aria-labelledby={listingTypeLabelId}>
        <p id={listingTypeLabelId} className="block text-sm font-medium text-neutral-700 mb-2">Listing type</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            ref={madeToOrderRef}
            type="button"
            role="radio"
            aria-checked={type === "MADE_TO_ORDER"}
            tabIndex={type === "MADE_TO_ORDER" ? 0 : -1}
            onClick={() => changeType("MADE_TO_ORDER")}
            onKeyDown={(event) => handleListingTypeKeyDown(event, "MADE_TO_ORDER")}
            className={`rounded-md border px-3 py-2.5 text-sm font-medium text-left transition-colors ${
              type === "MADE_TO_ORDER"
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            Made to Order
          </button>
          <button
            ref={inStockRef}
            type="button"
            role="radio"
            aria-checked={type === "IN_STOCK"}
            tabIndex={type === "IN_STOCK" ? 0 : -1}
            onClick={() => changeType("IN_STOCK")}
            onKeyDown={(event) => handleListingTypeKeyDown(event, "IN_STOCK")}
            className={`rounded-md border px-3 py-2.5 text-sm font-medium text-left transition-colors ${
              type === "IN_STOCK"
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            In Stock
          </button>
        </div>
        <input type="hidden" name="listingType" value={type} />
      </div>

      {type === "MADE_TO_ORDER" && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-neutral-500">Processing time (days)</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="mb-1 text-neutral-700">Min days</div>
              <input
                name="processingTimeMinDays"
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                placeholder="1"
                defaultValue={minDays ?? ""}
                className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 text-neutral-700">Max days</div>
              <input
                name="processingTimeMaxDays"
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                placeholder="7"
                defaultValue={maxDays ?? ""}
                className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm"
              />
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            How long you need to prepare the item before shipping.
          </p>
        </div>
      )}

      {type === "IN_STOCK" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="mb-1 text-neutral-700">Quantity in stock</div>
              <input
                name="stockQuantity"
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                max={MAX_MANUAL_STOCK_QUANTITY}
                placeholder="1"
                defaultValue={stockQuantity ?? 1}
                className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1 text-neutral-700">Ships within (days)</div>
              <input
                name="shipsWithinDays"
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                placeholder="3"
                defaultValue={shipsWithinDays ?? ""}
                className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm"
              />
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            Quantity available and how quickly you ship in-stock items.
          </p>
        </div>
      )}
    </div>
  );
}

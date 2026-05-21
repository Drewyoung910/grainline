"use client";

import { useId, useState, useCallback } from "react";

export type VariantGroupForSelector = {
  id: string;
  name: string;
  options: {
    id: string;
    label: string;
    priceAdjustCents: number;
    inStock: boolean;
  }[];
};

export default function VariantSelector({
  groups,
  basePriceCents,
  onSelectionChange,
  initialSelectedOptionIds = [],
}: {
  groups: VariantGroupForSelector[];
  basePriceCents: number;
  onSelectionChange: (selectedOptionIds: string[], totalPriceCents: number) => void;
  initialSelectedOptionIds?: string[];
}) {
  const baseId = useId();
  // Map of groupId -> selected optionId
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const initialIds = new Set(initialSelectedOptionIds);
    const next: Record<string, string> = {};
    for (const group of groups) {
      const option = group.options.find((opt) => initialIds.has(opt.id) && opt.inStock);
      if (option) next[group.id] = option.id;
    }
    return next;
  });

  const selectOption = useCallback(
    (groupId: string, optionId: string) => {
      const next = { ...selected, [groupId]: optionId };
      setSelected(next);

      const ids = Object.values(next);
      const adjust = ids.reduce((sum, oid) => {
        for (const g of groups) {
          const opt = g.options.find((o) => o.id === oid);
          if (opt) return sum + opt.priceAdjustCents;
        }
        return sum;
      }, 0);
      onSelectionChange(ids, basePriceCents + adjust);
    },
    [selected, groups, basePriceCents, onSelectionChange]
  );

  const moveSelection = useCallback(
    (group: VariantGroupForSelector, currentOptionId: string | undefined, direction: "next" | "prev" | "first" | "last") => {
      const availableOptions = group.options.filter((option) => option.inStock);
      if (availableOptions.length === 0) return;

      let nextOption = availableOptions[0];
      if (direction === "last") {
        nextOption = availableOptions[availableOptions.length - 1];
      } else if (direction === "next" || direction === "prev") {
        const currentIndex = Math.max(0, availableOptions.findIndex((option) => option.id === currentOptionId));
        const delta = direction === "next" ? 1 : -1;
        nextOption = availableOptions[(currentIndex + delta + availableOptions.length) % availableOptions.length];
      }
      selectOption(group.id, nextOption.id);
    },
    [selectOption],
  );

  // All required groups must have a selection for "complete"
  const allSelected = groups.every((g) => selected[g.id]);

  return (
    <div className="min-w-0 space-y-4">
      {groups.map((group) => (
        <div key={group.id} className="min-w-0">
          <p id={`${baseId}-${group.id}-label`} className="block text-sm font-medium text-neutral-700 mb-2">
            {group.name}
          </p>
          <div
            role="radiogroup"
            aria-labelledby={`${baseId}-${group.id}-label`}
            className="flex min-w-0 flex-wrap gap-2"
          >
            {group.options.map((opt) => {
              const isSelected = selected[group.id] === opt.id;
              const selectedOptionId = selected[group.id];
              const firstAvailableId = group.options.find((option) => option.inStock)?.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-disabled={!opt.inStock}
                  tabIndex={opt.inStock && (isSelected || (!selectedOptionId && opt.id === firstAvailableId)) ? 0 : -1}
                  disabled={!opt.inStock}
                  onClick={() => selectOption(group.id, opt.id)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                      event.preventDefault();
                      moveSelection(group, selectedOptionId, "next");
                    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                      event.preventDefault();
                      moveSelection(group, selectedOptionId, "prev");
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      moveSelection(group, selectedOptionId, "first");
                    } else if (event.key === "End") {
                      event.preventDefault();
                      moveSelection(group, selectedOptionId, "last");
                    }
                  }}
                  className={`max-w-full whitespace-normal break-words px-3 py-1.5 text-left rounded-md text-sm border transition-colors ${
                    isSelected
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : opt.inStock
                        ? "border-neutral-200 bg-[#F7F5F0] text-neutral-700 hover:border-neutral-400 hover:bg-white"
                        : "border-neutral-100 bg-[#F7F5F0] text-neutral-300 cursor-not-allowed line-through"
                  }`}
                >
                  {opt.label}
                  {opt.priceAdjustCents !== 0 && (
                    <span className="ml-1 text-xs opacity-70">
                      {opt.priceAdjustCents > 0 ? "+" : ""}
                      ${(opt.priceAdjustCents / 100).toFixed(2)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {groups.length > 0 && !allSelected && (
        <p className="text-xs text-amber-600">Please select all options to continue</p>
      )}
    </div>
  );
}

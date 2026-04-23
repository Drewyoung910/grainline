"use client";

import { useState, useMemo, useCallback } from "react";

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
}: {
  groups: VariantGroupForSelector[];
  basePriceCents: number;
  onSelectionChange: (selectedOptionIds: string[], totalPriceCents: number) => void;
}) {
  // Map of groupId → selected optionId
  const [selected, setSelected] = useState<Record<string, string>>({});

  const totalAdjust = useMemo(() => {
    return Object.values(selected).reduce((sum, optId) => {
      for (const g of groups) {
        const opt = g.options.find((o) => o.id === optId);
        if (opt) return sum + opt.priceAdjustCents;
      }
      return sum;
    }, 0);
  }, [selected, groups]);

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

  // All required groups must have a selection for "complete"
  const allSelected = groups.every((g) => selected[g.id]);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.id}>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            {group.name}
          </label>
          <div className="flex flex-wrap gap-2">
            {group.options.map((opt) => {
              const isSelected = selected[group.id] === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={!opt.inStock}
                  onClick={() => selectOption(group.id, opt.id)}
                  className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                    isSelected
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : opt.inStock
                        ? "border-neutral-200 text-neutral-700 hover:border-neutral-400"
                        : "border-neutral-100 text-neutral-300 cursor-not-allowed line-through"
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

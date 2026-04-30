"use client";

import { useState, useCallback } from "react";

export type VariantGroupData = {
  id?: string;
  name: string;
  options: VariantOptionData[];
};

export type VariantOptionData = {
  id?: string;
  label: string;
  priceAdjustCents: number;
  inStock: boolean;
};

const MAX_GROUPS = 3;
const MAX_OPTIONS = 10;

export default function VariantEditor({
  initialGroups = [],
}: {
  initialGroups?: VariantGroupData[];
}) {
  const [groups, setGroups] = useState<VariantGroupData[]>(initialGroups);

  const addGroup = useCallback(() => {
    if (groups.length >= MAX_GROUPS) return;
    setGroups((prev) => [
      ...prev,
      { name: "", options: [{ label: "", priceAdjustCents: 0, inStock: true }] },
    ]);
  }, [groups.length]);

  const removeGroup = useCallback((gi: number) => {
    setGroups((prev) => prev.filter((_, i) => i !== gi));
  }, []);

  const updateGroupName = useCallback((gi: number, name: string) => {
    setGroups((prev) =>
      prev.map((g, i) => (i === gi ? { ...g, name } : g))
    );
  }, []);

  const addOption = useCallback((gi: number) => {
    setGroups((prev) =>
      prev.map((g, i) =>
        i === gi && g.options.length < MAX_OPTIONS
          ? { ...g, options: [...g.options, { label: "", priceAdjustCents: 0, inStock: true }] }
          : g
      )
    );
  }, []);

  const removeOption = useCallback((gi: number, oi: number) => {
    setGroups((prev) =>
      prev.map((g, i) =>
        i === gi ? { ...g, options: g.options.filter((_, j) => j !== oi) } : g
      )
    );
  }, []);

  const updateOption = useCallback(
    (gi: number, oi: number, field: keyof VariantOptionData, value: string | number | boolean) => {
      setGroups((prev) =>
        prev.map((g, i) =>
          i === gi
            ? {
                ...g,
                options: g.options.map((o, j) =>
                  j === oi ? { ...o, [field]: value } : o
                ),
              }
            : g
        )
      );
    },
    []
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-neutral-700">Variants</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Add options like size, wood type, or finish. Up to {MAX_GROUPS} groups.
          </p>
        </div>
        {groups.length < MAX_GROUPS && (
          <button
            type="button"
            onClick={addGroup}
            className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 transition-colors"
          >
            + Add variant group
          </button>
        )}
      </div>

      {groups.map((group, gi) => (
        <div
          key={gi}
          className="card-section p-4 space-y-3"
        >
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-neutral-500 mb-1">
                Group name
              </label>
              <input
                type="text"
                value={group.name}
                onChange={(e) => updateGroupName(gi, e.target.value)}
                placeholder="e.g. Size, Wood Type, Finish"
                maxLength={50}
                className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => removeGroup(gi)}
              className="mt-5 rounded-md border border-red-200 px-2.5 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
              title="Remove group"
            >
              Remove
            </button>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-neutral-500">
              Options ({group.options.length}/{MAX_OPTIONS})
            </label>
            {group.options.map((opt, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <input
                  type="text"
                  value={opt.label}
                  onChange={(e) => updateOption(gi, oi, "label", e.target.value)}
                  placeholder="Option name"
                  maxLength={50}
                  className="flex-1 border border-neutral-200 rounded-md px-3 py-1.5 text-sm"
                />
                <div className="relative w-28">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-neutral-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={opt.priceAdjustCents === 0 ? "" : (opt.priceAdjustCents / 100).toFixed(2)}
                    onChange={(e) => {
                      const val = e.target.value;
                      const parsed = parseFloat(val);
                      updateOption(gi, oi, "priceAdjustCents", val === "" || isNaN(parsed) ? 0 : Math.round(parsed * 100));
                    }}
                    placeholder="+0.00"
                    className="w-full border border-neutral-200 rounded-md pl-6 pr-2 py-1.5 text-sm"
                  />
                </div>
                <label className="flex items-center gap-1.5 text-xs text-neutral-600 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={opt.inStock}
                    onChange={(e) => updateOption(gi, oi, "inStock", e.target.checked)}
                    className="accent-neutral-900"
                  />
                  In stock
                </label>
                <button
                  type="button"
                  onClick={() => removeOption(gi, oi)}
                  disabled={group.options.length <= 1}
                  className="rounded p-1 text-neutral-500 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Remove option"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
            {group.options.length < MAX_OPTIONS && (
              <button
                type="button"
                onClick={() => addOption(gi)}
                className="text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                + Add option
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Serialize to hidden input for form submission */}
      <input
        type="hidden"
        name="variantGroupsJson"
        value={JSON.stringify(
          groups
            .filter((g) => g.name.trim() && g.options.some((o) => o.label.trim()))
            .map((g) => ({
              name: g.name.trim(),
              options: g.options
                .filter((o) => o.label.trim())
                .map((o) => ({
                  label: o.label.trim(),
                  priceAdjustCents: o.priceAdjustCents || 0,
                  inStock: o.inStock,
                })),
            }))
        )}
      />
    </div>
  );
}

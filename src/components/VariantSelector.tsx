"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { DEFAULT_CURRENCY, formatCurrencyCents } from "@/lib/money";

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

// Position of the sliding highlight behind a group's selected option.
// `settled` is false on its first placement so it appears in place instead of
// sliding in from the corner.
type SelectionInk = { x: number; y: number; width: number; height: number; settled: boolean };

function samePlace(a: SelectionInk | undefined, b: Omit<SelectionInk, "settled">) {
  return Boolean(a) && a!.x === b.x && a!.y === b.y && a!.width === b.width && a!.height === b.height;
}

export default function VariantSelector({
  groups,
  basePriceCents,
  currency = DEFAULT_CURRENCY,
  onSelectionChange,
  initialSelectedOptionIds = [],
  blockedAttemptCount = 0,
}: {
  groups: VariantGroupForSelector[];
  basePriceCents: number;
  currency?: string | null;
  onSelectionChange: (selectedOptionIds: string[], totalPriceCents: number) => void;
  initialSelectedOptionIds?: string[];
  // Bumped each time the buyer tries to buy before choosing every option;
  // the reminder then appears (even with nothing chosen yet) and shakes.
  blockedAttemptCount?: number;
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

  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [inks, setInks] = useState<Record<string, SelectionInk>>({});
  // Groups whose last pick moved the highlight from an earlier choice. Those
  // options wait for it to arrive before turning see-through; a first pick
  // fills in place instead.
  const [sliding, setSliding] = useState<Record<string, boolean>>({});

  const selectOption = useCallback(
    (groupId: string, optionId: string) => {
      const next = { ...selected, [groupId]: optionId };
      setSelected(next);
      const previousOptionId = selected[groupId];
      if (previousOptionId !== optionId) {
        setSliding((current) => ({ ...current, [groupId]: Boolean(previousOptionId && inks[groupId]) }));
      }

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
    [selected, inks, groups, basePriceCents, onSelectionChange]
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

  useLayoutEffect(() => {
    // A selection change slides the highlight; a resize (wrapping, rotation)
    // moves it straight to the new spot.
    const measure = (fromResize: boolean) => {
      setInks((previous) => {
        const next: Record<string, SelectionInk> = {};
        let changed = false;
        for (const group of groups) {
          const optionId = selected[group.id];
          const container = groupRefs.current[group.id];
          if (!optionId || !container) continue;
          const button = container.querySelector<HTMLElement>(`[data-option-id="${CSS.escape(optionId)}"]`);
          if (!button) continue;
          const place = {
            x: button.offsetLeft,
            y: button.offsetTop,
            width: button.offsetWidth,
            height: button.offsetHeight,
          };
          next[group.id] = samePlace(previous[group.id], place)
            ? previous[group.id]
            : { ...place, settled: Boolean(previous[group.id]) && !fromResize };
          if (next[group.id] !== previous[group.id]) changed = true;
        }
        if (Object.keys(previous).length !== Object.keys(next).length) changed = true;
        return changed ? next : previous;
      });
    };
    measure(false);
    if (typeof ResizeObserver === "undefined") return;
    // Applied before the next paint so the highlight never shows in its old spot.
    const observer = new ResizeObserver(() => flushSync(() => measure(true)));
    for (const container of Object.values(groupRefs.current)) {
      if (container) observer.observe(container);
    }
    return () => observer.disconnect();
  }, [groups, selected]);

  // All required groups must have a selection for "complete"
  const allSelected = groups.every((g) => selected[g.id]);
  // The reminder only appears once the buyer has started choosing; on first
  // load nothing is wrong yet, and the buy buttons validate on click.
  const anySelected = groups.some((g) => selected[g.id]);

  return (
    <div className="min-w-0 space-y-4">
      {groups.map((group) => (
        <div key={group.id} className="min-w-0">
          <p id={`${baseId}-${group.id}-label`} className="block text-sm font-medium text-neutral-700 mb-2">
            {group.name}
          </p>
          <div
            ref={(node) => {
              groupRefs.current[group.id] = node;
            }}
            role="radiogroup"
            aria-labelledby={`${baseId}-${group.id}-label`}
            className="relative flex min-w-0 flex-wrap gap-2"
          >
            {/* Highlight sits above unselected options and below the selected
                one, so its slide between choices stays visible. */}
            {inks[group.id] && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-0 z-[1] rounded-md bg-[#2C1F1A] motion-safe:transition-[translate,width,height] motion-safe:duration-[260ms] motion-safe:ease-[cubic-bezier(0.2,0.7,0.2,1)]"
                style={{
                  width: inks[group.id].width,
                  height: inks[group.id].height,
                  translate: `${inks[group.id].x}px ${inks[group.id].y}px`,
                  transition: inks[group.id].settled ? undefined : "none",
                }}
              />
            )}
            {group.options.map((opt) => {
              const isSelected = selected[group.id] === opt.id;
              const showsInk = isSelected && sliding[group.id] && Boolean(inks[group.id]);
              const selectedOptionId = selected[group.id];
              const firstAvailableId = group.options.find((option) => option.inStock)?.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-option-id={opt.id}
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
                  className={`relative max-w-full whitespace-normal break-words px-3 py-1.5 text-left rounded-md text-sm border transition-[color,background-color,border-color,scale] ease-out ${
                    showsInk
                      ? "z-[2] border-transparent bg-transparent text-white duration-150 motion-safe:delay-[130ms] motion-safe:active:scale-[0.97]"
                      : isSelected
                        ? "z-[2] border-[#2C1F1A] bg-[#2C1F1A] text-white duration-200 motion-safe:active:scale-[0.97]"
                        : opt.inStock
                          ? "border-neutral-200 bg-[#F7F5F0] text-neutral-700 duration-200 hover:border-neutral-400 hover:bg-white motion-safe:active:scale-[0.97]"
                          : "border-neutral-100 bg-[#F7F5F0] text-neutral-300 duration-200 cursor-not-allowed line-through"
                  }`}
                >
                  {opt.label}
                  {opt.priceAdjustCents !== 0 && (
                    <span className="ml-1 text-xs opacity-70">
                      {opt.priceAdjustCents > 0 ? "+" : "-"}
                      {formatCurrencyCents(Math.abs(opt.priceAdjustCents), currency)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {groups.length > 0 && (anySelected || blockedAttemptCount > 0) && !allSelected && (
        <p
          key={blockedAttemptCount}
          role={blockedAttemptCount > 0 ? "alert" : undefined}
          className={`text-xs text-amber-700${blockedAttemptCount > 0 ? " hint-shake" : ""}`}
        >
          Please select all options to continue
        </p>
      )}
    </div>
  );
}

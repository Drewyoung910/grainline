"use client";
import { useState } from "react";
import { DEFAULT_CURRENCY, formatCurrencyCents } from "@/lib/money";
import { truncateText } from "@/lib/sanitize";

export default function GiftNoteSection({
  offersGiftWrapping,
  giftWrappingPriceCents,
  giftNote,
  giftWrapping,
  currency = DEFAULT_CURRENCY,
  onChange,
}: {
  offersGiftWrapping: boolean;
  giftWrappingPriceCents: number | null;
  giftNote: string;
  giftWrapping: boolean;
  currency?: string | null;
  onChange: (note: string, wrapping: boolean) => void;
}) {
  const [isGift, setIsGift] = useState(giftNote !== "" || giftWrapping);

  function handleGiftToggle(checked: boolean) {
    setIsGift(checked);
    if (!checked) onChange("", false);
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={isGift}
          onChange={(e) => handleGiftToggle(e.target.checked)}
          className="h-4 w-4 accent-neutral-900"
        />
        <span>This is a gift</span>
      </label>

      {isGift && (
        <div className="space-y-3 pl-6">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Gift note <span className="font-normal text-neutral-500">(optional)</span>
            </label>
            <textarea
              value={giftNote}
              onChange={(e) => onChange(truncateText(e.target.value, 200), giftWrapping)}
              placeholder="Add a personal message..."
              rows={3}
              className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-stone-500 focus-visible:outline-none focus-visible:shadow-none"
            />
            <p className="text-xs text-neutral-500 text-right">{giftNote.length}/200</p>
          </div>

          {offersGiftWrapping && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={giftWrapping}
                onChange={(e) => onChange(giftNote, e.target.checked)}
                className="h-4 w-4 accent-neutral-900"
              />
              <span>
                Add gift wrapping
                {giftWrappingPriceCents != null && giftWrappingPriceCents > 0
                  ? ` (+${formatCurrencyCents(giftWrappingPriceCents, currency)})`
                  : " (free)"}
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

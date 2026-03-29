"use client";
import { useState } from "react";

export default function GiftNoteSection({
  offersGiftWrapping,
  giftWrappingPriceCents,
  giftNote,
  giftWrapping,
  onChange,
}: {
  offersGiftWrapping: boolean;
  giftWrappingPriceCents: number | null;
  giftNote: string;
  giftWrapping: boolean;
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
        />
        <span>This is a gift</span>
      </label>

      {isGift && (
        <div className="space-y-3 pl-6">
          <div>
            <label className="block text-sm mb-1">
              Gift note <span className="text-neutral-400">(optional)</span>
            </label>
            <textarea
              value={giftNote}
              onChange={(e) => onChange(e.target.value.slice(0, 200), giftWrapping)}
              placeholder="Add a personal message..."
              rows={3}
              className="w-full border rounded px-3 py-2 text-sm"
            />
            <p className="text-xs text-neutral-400 text-right">{giftNote.length}/200</p>
          </div>

          {offersGiftWrapping && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={giftWrapping}
                onChange={(e) => onChange(giftNote, e.target.checked)}
              />
              <span>
                Add gift wrapping
                {giftWrappingPriceCents != null && giftWrappingPriceCents > 0
                  ? ` (+$${(giftWrappingPriceCents / 100).toFixed(2)})`
                  : " (free)"}
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

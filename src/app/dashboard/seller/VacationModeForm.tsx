"use client";
// src/app/dashboard/seller/VacationModeForm.tsx
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface Props {
  sellerId: string;
  vacationMode: boolean;
  vacationReturnDate: Date | null;
  vacationMessage: string | null;
}

export default function VacationModeForm({
  vacationMode: initialVacationMode,
  vacationReturnDate: initialReturnDate,
  vacationMessage: initialMessage,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initialVacationMode);
  const [showWarning, setShowWarning] = useState(false);
  const [pendingEnable, setPendingEnable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [returnDate, setReturnDate] = useState(
    initialReturnDate
      ? new Date(initialReturnDate).toISOString().split("T")[0]
      : ""
  );
  const [message, setMessage] = useState(initialMessage ?? "");

  function handleToggleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const checked = e.target.checked;
    setError(null);
    setSaved(false);
    if (checked && !enabled) {
      // Show warning before enabling
      setPendingEnable(true);
      setShowWarning(true);
    } else if (!checked) {
      setEnabled(false);
    }
  }

  function confirmEnable() {
    setEnabled(true);
    setPendingEnable(false);
    setShowWarning(false);
  }

  function cancelEnable() {
    setPendingEnable(false);
    setShowWarning(false);
  }

  async function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await fetch("/api/seller/vacation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vacationMode: enabled,
          vacationReturnDate: returnDate || null,
          vacationMessage: message.trim() || null,
        }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
        window.setTimeout(() => setSaved(false), 2000);
        return;
      }

      const retryAfter = res.headers.get("Retry-After");
      const data = await res.json().catch(() => null) as { error?: string } | null;
      const baseMessage = data?.error || "Could not save vacation settings.";
      const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
      setError(
        res.status === 429 && Number.isFinite(retryAfterSeconds)
          ? `${baseMessage} Try again in ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minute(s).`
          : baseMessage,
      );
    });
  }

  const returnDateFormatted = returnDate
    ? new Date(returnDate + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="border border-neutral-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">Vacation Mode</h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Pause your shop while you&apos;re away. Your listings will be hidden and new orders blocked.
          </p>
        </div>
        {/* Toggle switch */}
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={enabled || pendingEnable}
            onChange={handleToggleChange}
          />
          <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:bg-amber-500 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
        </label>
      </div>

      {/* Warning modal before enabling */}
      {showWarning && (
        <div className="border border-amber-300 bg-amber-50 p-4 space-y-3">
          <p className="text-sm font-medium text-amber-900">Before enabling vacation mode:</p>
          <ul className="text-sm text-amber-800 space-y-1 list-disc list-inside">
            <li>Your existing orders must still be fulfilled and will not be cancelled automatically.</li>
            <li>Buyers with pending orders can still message you.</li>
            <li>New orders will be blocked and your listings will be hidden from browse until you return.</li>
          </ul>
          <div className="flex gap-3">
            <button
              onClick={confirmEnable}
              className="px-4 py-1.5 text-sm bg-amber-600 text-white hover:bg-amber-700 transition-colors"
            >
              Enable vacation mode
            </button>
            <button
              onClick={cancelEnable}
              className="px-4 py-1.5 text-sm border border-neutral-300 hover:bg-neutral-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Options shown when enabled */}
      {enabled && (
        <div className="space-y-4 pt-1">
          <div>
            <label className="block text-sm font-medium mb-1">
              Return date <span className="text-neutral-400 font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              className="border border-neutral-300 px-3 py-2 text-sm"
            />
            {returnDateFormatted && (
              <p className="text-xs text-neutral-500 mt-1">Shown to buyers as: Expected return {returnDateFormatted}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Vacation message <span className="text-neutral-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 200))}
              rows={3}
              maxLength={200}
              placeholder="Let buyers know when you'll be back or why you're away. This is shown on your profile page."
              className="w-full border border-neutral-300 px-3 py-2 text-sm resize-none"
            />
            <p className="text-xs text-neutral-400 text-right">{message.length}/200</p>
          </div>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={isPending || showWarning}
        className="px-4 py-2 text-sm bg-neutral-900 text-white hover:bg-neutral-700 transition-colors disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save vacation settings"}
      </button>
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-sm text-green-700" role="status">
          Vacation settings saved.
        </p>
      )}
    </div>
  );
}

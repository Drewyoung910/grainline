"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Heart, Bell } from "@/components/icons";

type Listing = {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  status: string;
  stockQuantity: number | null;
  viewCount: number;
  clickCount: number;
  photos: Array<{ url: string }>;
  _count: { favorites: number; stockNotifications: number };
};

export default function InventoryRow({ listing }: { listing: Listing }) {
  const router = useRouter();
  const [qty, setQty] = React.useState<string>(String(listing.stockQuantity ?? 0));
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const savingRef = React.useRef(false);

  const thumb = listing.photos[0]?.url;

  async function handleSave() {
    if (savingRef.current) return;
    const quantity = parseInt(qty, 10);
    if (!Number.isFinite(quantity) || quantity < 0) {
      setError("Enter a valid quantity (0 or more).");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/listings/${listing.id}/stock`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quantity }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Save failed");
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <li className="flex items-center gap-4 px-4 py-3">
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="h-14 w-14 rounded border object-cover shrink-0" />
      ) : (
        <div className="h-14 w-14 rounded border bg-neutral-100 shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <Link
          href={`/dashboard/listings/${listing.id}/edit`}
          className="block truncate text-sm font-medium hover:underline"
        >
          {listing.title}
        </Link>
        <div className="text-xs text-neutral-500">
          {(listing.priceCents / 100).toLocaleString(undefined, {
            style: "currency",
            currency: listing.currency,
          })}
          {listing.status === "SOLD_OUT" && (
            <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-red-700">
              Out of stock
            </span>
          )}
          {listing.status === "DRAFT" && (
            <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">
              Draft
            </span>
          )}
          {listing.status === "HIDDEN" && (
            <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">
              Hidden
            </span>
          )}
          {listing.status === "PENDING_REVIEW" && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
              Under Review
            </span>
          )}
          {listing.status === "REJECTED" && (
            <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-red-700">
              Rejected
            </span>
          )}
        </div>
        <div className="text-[11px] text-neutral-400 mt-0.5">
          <Eye size={11} className="inline align-middle" /> {listing.viewCount} · clicks {listing.clickCount} · <Heart size={11} className="inline align-middle" /> {listing._count.favorites} · <Bell size={11} className="inline align-middle" /> {listing._count.stockNotifications}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {error && <span className="text-xs text-red-600">{error}</span>}
        {saved && <span className="text-xs text-green-600">Saved</span>}
        <input
          type="number"
          min="0"
          step="1"
          value={qty}
          disabled={saving}
          onChange={(e) => { setQty(e.target.value); setSaved(false); setError(null); }}
          className="w-20 rounded border px-2 py-1 text-sm text-right disabled:bg-neutral-50 disabled:text-neutral-400"
          aria-label="Stock quantity"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded border px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </li>
  );
}

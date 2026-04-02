// src/app/dashboard/seller/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { revalidatePath } from "next/cache";
import LocationPicker from "@/components/LocationPicker";
import VacationModeForm from "./VacationModeForm";
import BroadcastComposer from "@/components/BroadcastComposer";
import GalleryUploader from "@/components/GalleryUploader";
import StripeLoginButton from "./StripeLoginButton";
import StripeConnectButton from "./StripeConnectButton";
import { sanitizeText, sanitizeRichText } from "@/lib/sanitize";

function toNull(v: unknown) {
  const s = typeof v === "string" ? v.trim() : v;
  return s === "" || s === undefined ? null : s;
}
function toFloat(v: unknown) {
  const s = typeof v === "string" ? v.trim() : v;
  if (s === "" || s === undefined) return null;
  const n = parseFloat(String(s));
  return Number.isFinite(n) ? n : null;
}

async function updateSellerProfile(formData: FormData) {
  "use server";

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/seller");

  const { seller } = await ensureSeller();

  const displayName = sanitizeText(String(formData.get("displayName") ?? "").trim());
  const city = toNull(formData.get("city"));
  const state = toNull(formData.get("state"));
  const bioRaw = toNull(formData.get("bio"));
  const bio = bioRaw ? sanitizeRichText(String(bioRaw)) : null;

  // Location (for pickup map)
  const lat = toFloat(formData.get("lat"));
  const lng = toFloat(formData.get("lng"));
  let radiusMeters = toFloat(formData.get("radiusMeters"));
  const publicMapOptIn = String(formData.get("publicMapOptIn") ?? "") === "on";

  // Shipping/tax in dollars
  const shippingFlatRate = toFloat(formData.get("shippingFlatRate"));
  const freeShippingOver = toFloat(formData.get("freeShippingOver"));
  const allowLocalPickup = String(formData.get("allowLocalPickup") ?? "") === "on";
  const useCalculatedShipping = String(formData.get("useCalculatedShipping") ?? "") === "on"; // 👈 NEW

  if (!displayName) throw new Error("Display name is required.");
  if (publicMapOptIn) {
    if (!(Number.isFinite(lat as number) && Number.isFinite(lng as number))) {
      throw new Error("To appear on the public map, set an exact pin location.");
    }
    // exact pin for public map
    radiusMeters = 0;
  }

  // Ship-from address
  const shipFromName = toNull(formData.get("shipFromName"));
  const shipFromLine1 = toNull(formData.get("shipFromLine1"));
  const shipFromLine2 = toNull(formData.get("shipFromLine2"));
  const shipFromCity = toNull(formData.get("shipFromCity"));
  const shipFromState = toNull(formData.get("shipFromState"));
  const shipFromPostal = toNull(formData.get("shipFromPostal"));
  const shipFromCountry = toNull(formData.get("shipFromCountry")) ?? "US";

  // Gallery images
  const galleryImageUrls = formData.getAll("galleryImageUrls").map(String).filter(Boolean);

  // Default package (cm / g)
  const defaultPkgLengthCm = toFloat(formData.get("defaultPkgLengthCm"));
  const defaultPkgWidthCm = toFloat(formData.get("defaultPkgWidthCm"));
  const defaultPkgHeightCm = toFloat(formData.get("defaultPkgHeightCm"));
  const defaultPkgWeightGrams = (() => {
    const v = formData.get("defaultPkgWeightGrams");
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : null;
  })();

  await prisma.sellerProfile.update({
    where: { id: seller.id },
    data: {
      displayName,
      city,
      state,
      bio,
      lat: lat as number | null,
      lng: lng as number | null,
      radiusMeters: radiusMeters as number | null,
      publicMapOptIn,

      // shipping prefs
      shippingFlatRate,
      freeShippingOver,
      allowLocalPickup,
      useCalculatedShipping, // 👈 NEW

      // ship-from
      shipFromName,
      shipFromLine1,
      shipFromLine2,
      shipFromCity,
      shipFromState,
      shipFromPostal,
      shipFromCountry,

      // defaults
      defaultPkgLengthCm,
      defaultPkgWidthCm,
      defaultPkgHeightCm,
      defaultPkgWeightGrams,

      // gallery
      ...(galleryImageUrls.length > 0 ? { galleryImageUrls } : {}),
    },
  });

  // Assign metro geography when lat/lng is set — non-fatal
  if (lat != null && lng != null) {
    try {
      const { findOrCreateMetro } = await import("@/lib/geo-metro");
      const { metroId, cityMetroId } = await findOrCreateMetro(lat, lng);
      await prisma.sellerProfile.update({ where: { id: seller.id }, data: { metroId, cityMetroId } });
    } catch (e) {
      console.error("[geo-metro] Failed to assign metro to seller profile:", e);
    }
  }

  revalidatePath(`/seller/${seller.id}`);
  redirect(`/seller/${seller.id}`);
}

export default async function SellerSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/seller");

  const { seller } = await ensureSeller();
  const [row, followerCount, draftCount] = await Promise.all([
    prisma.sellerProfile.findUnique({ where: { id: seller.id } }),
    prisma.follow.count({ where: { sellerProfileId: seller.id } }),
    prisma.listing.count({ where: { sellerId: seller.id, status: "DRAFT" } }),
  ]);

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-semibold font-display">Shop Settings</h1>

      {/* Payouts & Banking */}
      <section className="card-section p-6 space-y-3">
        <h2 className="font-display text-xl font-semibold">Payouts & Banking</h2>
        <p className="text-sm text-neutral-500">
          View your balance, payout history, and update your bank account in your Stripe dashboard.
        </p>
        {row?.stripeAccountId ? (
          <div className="space-y-3">
            <p className="text-sm text-green-700 font-medium">✓ Stripe Connected</p>
            <StripeLoginButton hasStripeAccount={true} />
            {draftCount > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-sm text-amber-800 font-medium">
                  You have {draftCount} draft {draftCount === 1 ? "listing" : "listings"} ready to activate.
                </p>
                <a
                  href="/dashboard/inventory"
                  className="text-sm text-amber-700 underline"
                >
                  Go to inventory to publish →
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-neutral-500">
              Connect Stripe to receive payouts from your sales.
            </p>
            <StripeConnectButton />
          </div>
        )}
      </section>

      {/* Vacation Mode */}
      <VacationModeForm
        sellerId={seller.id}
        vacationMode={row?.vacationMode ?? false}
        vacationReturnDate={row?.vacationReturnDate ?? null}
        vacationMessage={row?.vacationMessage ?? null}
      />

      <form action={updateSellerProfile} className="space-y-6">
        <div>
          <label className="block text-sm mb-1">Display name</label>
          <input
            name="displayName"
            required
            defaultValue={row?.displayName ?? ""}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">City</label>
            <input
              name="city"
              defaultValue={row?.city ?? ""}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">State</label>
            <input
              name="state"
              defaultValue={row?.state ?? ""}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        {/* Location picker */}
        <div>
          <label className="block text-sm mb-2">Pickup location</label>
          <LocationPicker
            defaultLat={row?.lat != null ? Number(row.lat) : null}
            defaultLng={row?.lng != null ? Number(row.lng) : null}
            defaultRadiusMeters={row?.radiusMeters ?? null}
          />
          <p className="mt-2 text-xs text-neutral-500">
            Drag the pin or click the map to set your pickup spot.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <input
              id="publicMapOptIn"
              name="publicMapOptIn"
              type="checkbox"
              defaultChecked={row?.publicMapOptIn ?? false}
            />
            <label htmlFor="publicMapOptIn" className="text-sm">
              Show me on the public makers map
            </label>
          </div>
        </div>

        {/* 🚚 Shipping & Tax Settings */}
        <div className="border-t pt-4 space-y-4">
          <h2 className="text-lg font-medium">Shipping & Tax</h2>

          <div>
            <label className="block text-sm mb-1">Flat shipping rate ($)</label>
            <input
              type="number"
              step="0.01"
              name="shippingFlatRate"
              defaultValue={row?.shippingFlatRate ?? ""}
              className="w-full border rounded px-3 py-2"
              placeholder="e.g. 7.00"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Free shipping over ($)</label>
            <input
              type="number"
              step="0.01"
              name="freeShippingOver"
              defaultValue={row?.freeShippingOver ?? ""}
              className="w-full border rounded px-3 py-2"
              placeholder="e.g. 50.00"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="allowLocalPickup"
              name="allowLocalPickup"
              type="checkbox"
              defaultChecked={row?.allowLocalPickup ?? false}
            />
            <label htmlFor="allowLocalPickup" className="text-sm">
              Allow local pickup
            </label>
          </div>

          {/* 👇 NEW: Calculated shipping toggle */}
          <div className="flex items-center gap-2">
            <input
              id="useCalculatedShipping"
              name="useCalculatedShipping"
              type="checkbox"
              defaultChecked={row?.useCalculatedShipping ?? false}
            />
            <label htmlFor="useCalculatedShipping" className="text-sm">
              Use calculated shipping (Shippo)
            </label>
          </div>
        </div>

        {/* 🏷️ Ship-from address */}
        <div className="border-t pt-4 space-y-3">
          <h2 className="text-lg font-medium">Ship from address</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input name="shipFromName" placeholder="Sender name"
                   defaultValue={row?.shipFromName ?? ""} className="rounded border px-3 py-2" />
            <input name="shipFromLine1" placeholder="Address line 1 *"
                   defaultValue={row?.shipFromLine1 ?? ""} className="rounded border px-3 py-2 md:col-span-2" />
            <input name="shipFromLine2" placeholder="Address line 2"
                   defaultValue={row?.shipFromLine2 ?? ""} className="rounded border px-3 py-2 md:col-span-2" />
            <input name="shipFromCity" placeholder="City *"
                   defaultValue={row?.shipFromCity ?? ""} className="rounded border px-3 py-2" />
            <input name="shipFromState" placeholder="State * (e.g., TX)"
                   defaultValue={row?.shipFromState ?? ""} className="rounded border px-3 py-2" />
            <input name="shipFromPostal" placeholder="Postal code *"
                   defaultValue={row?.shipFromPostal ?? ""} className="rounded border px-3 py-2" />
            <input name="shipFromCountry" placeholder="Country *"
                   defaultValue={row?.shipFromCountry ?? "US"} className="rounded border px-3 py-2" />
          </div>
        </div>

        {/* 📦 Default package (cm / g) */}
        <div className="border-t pt-4 space-y-3">
          <h2 className="text-lg font-medium">Default package (cm / g)</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input name="defaultPkgLengthCm" type="number" step="0.1" placeholder="Length (cm)"
                   defaultValue={row?.defaultPkgLengthCm ?? ""} className="rounded border px-3 py-2" />
            <input name="defaultPkgWidthCm" type="number" step="0.1" placeholder="Width (cm)"
                   defaultValue={row?.defaultPkgWidthCm ?? ""} className="rounded border px-3 py-2" />
            <input name="defaultPkgHeightCm" type="number" step="0.1" placeholder="Height (cm)"
                   defaultValue={row?.defaultPkgHeightCm ?? ""} className="rounded border px-3 py-2" />
            <input name="defaultPkgWeightGrams" type="number" step="1" placeholder="Weight (g)"
                   defaultValue={row?.defaultPkgWeightGrams ?? ""} className="rounded border px-3 py-2" />
          </div>
          <p className="text-xs text-neutral-500">
            These defaults are used for live carrier quotes when a listing doesn’t specify its own packaged size/weight.
          </p>
        </div>

        <div>
          <label className="block text-sm mb-1">Bio</label>
          <textarea
            name="bio"
            rows={5}
            defaultValue={row?.bio ?? ""}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        {/* Workshop Gallery */}
        <div className="border-t pt-4 space-y-3">
          <div>
            <h2 className="text-lg font-medium">Workshop Gallery</h2>
            <p className="text-sm text-neutral-500 mt-0.5">
              Show buyers your workspace and craftsmanship (up to 8 photos)
            </p>
          </div>
          <GalleryUploader
            initialUrls={row?.galleryImageUrls ?? []}
            maxImages={8}
          />
        </div>

        <button type="submit" className="rounded px-4 py-2 bg-black text-white">
          Save
        </button>
      </form>

      {/* Shop Updates / Broadcasts */}
      <section className="rounded-xl border p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Shop Updates</h2>
          <p className="text-sm text-neutral-500 mt-1">
            Send a message to all your followers — new projects, restocks, events, or anything you want to share.
          </p>
        </div>
        <BroadcastComposer followerCount={followerCount} />
      </section>
    </main>
  );
}





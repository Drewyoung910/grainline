// src/app/dashboard/seller/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { revalidatePath } from "next/cache";
import SellerLocationSection from "@/components/SellerLocationSection";
import VacationModeForm from "./VacationModeForm";
import BroadcastComposer from "@/components/BroadcastComposer";
import GalleryUploader from "@/components/GalleryUploader";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };
import StripeLoginButton from "./StripeLoginButton";
import StripeConnectButton from "./StripeConnectButton";
import { NotificationToggle } from "@/components/NotificationToggle";
import { sanitizeText, sanitizeRichText } from "@/lib/sanitize";
import { ensureUser } from "@/lib/ensureUser";
import { filterR2PublicUrls } from "@/lib/urlValidation";

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
  const shippingFlatRateRaw = toFloat(formData.get("shippingFlatRate"));
  const shippingFlatRateCents = shippingFlatRateRaw != null ? Math.round(shippingFlatRateRaw * 100) : null;
  const freeShippingOverRaw = toFloat(formData.get("freeShippingOver"));
  const freeShippingOverCents = freeShippingOverRaw != null ? Math.round(freeShippingOverRaw * 100) : null;
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

  // Preferred carriers
  const preferredCarriers = formData.getAll("preferredCarriers").map(String).filter(Boolean);

  // Gallery images
  const galleryImageUrls = filterR2PublicUrls(
    formData.getAll("galleryImageUrls").map(String).filter(Boolean),
    10,
  );

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
      shippingFlatRateCents,
      freeShippingOverCents,
      allowLocalPickup,
      useCalculatedShipping,
      preferredCarriers,

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
  const me = await ensureUser();
  const [row, followerCount, draftCount, userRow] = await Promise.all([
    prisma.sellerProfile.findUnique({ where: { id: seller.id } }),
    prisma.follow.count({ where: { sellerProfileId: seller.id } }),
    prisma.listing.count({ where: { sellerId: seller.id, status: "DRAFT" } }),
    me ? prisma.user.findUnique({ where: { id: me.id }, select: { notificationPreferences: true } }) : null,
  ]);

  const prefs = (userRow?.notificationPreferences as Record<string, boolean>) ?? {};
  const SELLER_DEFAULT_OFF = ["NEW_FAVORITE", "NEW_BLOG_COMMENT", "BLOG_COMMENT_REPLY", "EMAIL_NEW_FOLLOWER"];
  function isEnabled(type: string) {
    if (SELLER_DEFAULT_OFF.includes(type)) return prefs[type] === true;
    return prefs[type] !== false;
  }
  function getEmailPref(key: string): boolean {
    if (key in prefs) return prefs[key] as boolean;
    return !["EMAIL_NEW_FOLLOWER"].includes(key);
  }

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-semibold font-display">Shop Settings</h1>

      {/* Payouts & Banking */}
      <section className="card-section p-6 space-y-3">
        <h2 className="font-display text-xl font-semibold">Payouts & Banking</h2>
        <p className="text-sm text-neutral-500">
          View your balance, payout history, and update your bank account in your Stripe dashboard.
        </p>
        {row?.chargesEnabled && row?.stripeAccountId ? (
          <div className="space-y-3">
            <p className="text-sm text-green-700 font-medium">✓ Stripe Connected</p>
            <StripeLoginButton hasStripeAccount={true} />
            {draftCount > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-sm text-amber-800 font-medium">
                  You have {draftCount} draft {draftCount === 1 ? "listing" : "listings"} ready to activate.
                </p>
                <a
                  href={`/seller/${seller.id}/shop?status=DRAFT`}
                  className="text-sm text-amber-700 underline"
                >
                  Go to My Shop to publish →
                </a>
              </div>
            )}
          </div>
        ) : row?.stripeAccountId && !row?.chargesEnabled ? (
          <div className="space-y-3">
            <p className="text-sm text-amber-700 font-medium">⚠ Stripe setup incomplete</p>
            <p className="text-sm text-neutral-500">
              You started Stripe setup but didn&apos;t finish. Complete it to receive payouts and publish listings.
            </p>
            <StripeConnectButton />
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
          <label className="block text-sm font-medium text-neutral-700 mb-1">Display name</label>
          <input
            name="displayName"
            required
            autoComplete="name"
            defaultValue={row?.displayName ?? ""}
            className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">City</label>
            <input
              name="city"
              autoComplete="address-level2"
              defaultValue={row?.city ?? ""}
              className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">State</label>
            <input
              name="state"
              autoComplete="address-level1"
              defaultValue={row?.state ?? ""}
              className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Location picker */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">Pickup location</label>
          <SellerLocationSection
            defaultLat={row?.lat != null ? Number(row.lat) : null}
            defaultLng={row?.lng != null ? Number(row.lng) : null}
            defaultRadiusMeters={row?.radiusMeters ?? null}
            defaultPublicMapOptIn={row?.publicMapOptIn ?? false}
          />
          <p className="mt-2 text-xs text-neutral-500">
            Drag the pin or click the map to set your pickup spot.
          </p>
        </div>

        {/* Shipping & Tax Settings */}
        <div className="border-t border-neutral-100 pt-4 space-y-4">
          <h2 className="text-lg font-semibold font-display">Shipping & Tax</h2>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Flat shipping rate ($)</label>
            <input
              type="number"
              step="0.01"
              name="shippingFlatRate"
              autoComplete="off"
              defaultValue={row?.shippingFlatRateCents != null ? (row.shippingFlatRateCents / 100).toFixed(2) : ""}
              className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm"
              placeholder="e.g. 7.00"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Free shipping over ($)</label>
            <input
              type="number"
              step="0.01"
              name="freeShippingOver"
              autoComplete="off"
              defaultValue={row?.freeShippingOverCents != null ? (row.freeShippingOverCents / 100).toFixed(2) : ""}
              className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm"
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

          {/* Preferred Carriers */}
          <div className="space-y-2">
            <label className="block text-sm font-medium">Preferred carriers</label>
            <p className="text-xs text-neutral-500">Only show rates from selected carriers. Leave all unchecked to show all available carriers.</p>
            {["UPS", "USPS", "FedEx", "DHL"].map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name="preferredCarriers"
                  value={c}
                  defaultChecked={row?.preferredCarriers?.includes(c)}
                  className="accent-neutral-900"
                />
                {c}
              </label>
            ))}
          </div>
        </div>

        {/* 🏷️ Ship-from address */}
        <div className="border-t border-neutral-100 pt-4 space-y-3">
          <h2 className="text-lg font-semibold font-display">Ship from address</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input name="shipFromName" autoComplete="name" placeholder="Sender name"
                   defaultValue={row?.shipFromName ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
            <input name="shipFromLine1" autoComplete="address-line1" placeholder="Address line 1 *"
                   defaultValue={row?.shipFromLine1 ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm md:col-span-2" />
            <input name="shipFromLine2" autoComplete="address-line2" placeholder="Address line 2"
                   defaultValue={row?.shipFromLine2 ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm md:col-span-2" />
            <input name="shipFromCity" autoComplete="address-level2" placeholder="City *"
                   defaultValue={row?.shipFromCity ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
            <input name="shipFromState" autoComplete="address-level1" placeholder="State * (e.g., TX)"
                   defaultValue={row?.shipFromState ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
            <input name="shipFromPostal" autoComplete="postal-code" placeholder="Postal code *"
                   defaultValue={row?.shipFromPostal ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
            <input name="shipFromCountry" autoComplete="country" placeholder="Country *"
                   defaultValue={row?.shipFromCountry ?? "US"} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
          </div>
        </div>

        {/* Default package (cm / g) */}
        <div className="border-t border-neutral-100 pt-4 space-y-3">
          <h2 className="text-lg font-semibold font-display">Default package (cm / g)</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input name="defaultPkgLengthCm" type="number" step="0.1" placeholder="Length (cm)"
                   autoComplete="off"
                   defaultValue={row?.defaultPkgLengthCm ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
            <input name="defaultPkgWidthCm" type="number" step="0.1" placeholder="Width (cm)"
                   autoComplete="off"
                   defaultValue={row?.defaultPkgWidthCm ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
            <input name="defaultPkgHeightCm" type="number" step="0.1" placeholder="Height (cm)"
                   autoComplete="off"
                   defaultValue={row?.defaultPkgHeightCm ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
            <input name="defaultPkgWeightGrams" type="number" step="1" placeholder="Weight (g)"
                   autoComplete="off"
                   defaultValue={row?.defaultPkgWeightGrams ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
          </div>
          <p className="text-xs text-neutral-500">
            These defaults are used for live carrier quotes when a listing doesn’t specify its own packaged size/weight.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Bio</label>
          <textarea
            name="bio"
            autoComplete="off"
            rows={5}
            defaultValue={row?.bio ?? ""}
            className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm"
          />
        </div>

        {/* Workshop Gallery */}
        <div className="border-t border-neutral-100 pt-4 space-y-3">
          <div>
            <h2 className="text-lg font-semibold font-display">Workshop Gallery</h2>
            <p className="text-sm text-neutral-500 mt-0.5">
              Show buyers your workspace and craftsmanship (up to 8 photos)
            </p>
          </div>
          <GalleryUploader
            initialUrls={row?.galleryImageUrls ?? []}
            maxImages={8}
          />
        </div>

        <button type="submit" className="rounded-md px-4 py-2.5 bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800">
          Save settings
        </button>
      </form>

      {/* Shop Notifications */}
      <section className="card-section p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold font-display">Shop Notifications</h2>
          <p className="text-sm text-neutral-500 mt-1">Notifications about your shop and listings.</p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">In-app</h3>
          {[
            { type: "NEW_MESSAGE", label: "New messages", desc: "When someone sends you a message" },
            { type: "NEW_REVIEW", label: "New reviews", desc: "When a buyer leaves a review" },
            { type: "NEW_FOLLOWER", label: "New followers", desc: "When someone follows your shop" },
            { type: "CUSTOM_ORDER_REQUEST", label: "Custom order requests", desc: "When a buyer requests a custom piece" },
            { type: "NEW_FAVORITE", label: "Someone saves your listing", desc: "When a buyer hearts one of your pieces (off by default)" },
            { type: "CASE_OPENED", label: "Cases opened", desc: "When a buyer opens a case on one of your orders" },
            { type: "NEW_BLOG_COMMENT", label: "Blog comments", desc: "When someone comments on your blog post (off by default)" },
            { type: "BLOG_COMMENT_REPLY", label: "Blog replies", desc: "When someone replies to your comment (off by default)" },
          ].map((r) => (
            <div key={r.type} className="flex items-center justify-between py-3 border-b border-neutral-100 last:border-0">
              <div>
                <p className="text-sm font-medium text-neutral-800">{r.label}</p>
                <p className="text-xs text-neutral-400 mt-0.5">{r.desc}</p>
              </div>
              <NotificationToggle type={r.type} enabled={isEnabled(r.type)} />
            </div>
          ))}
        </div>

        <div className="border-t border-neutral-100 pt-4">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">Email</h3>
          {[
            { type: "EMAIL_NEW_ORDER", label: "New orders", desc: "Email when a buyer purchases from your shop" },
            { type: "EMAIL_CUSTOM_ORDER", label: "Custom order requests", desc: "Email when a buyer sends you a custom order request" },
            { type: "EMAIL_CASE_OPENED", label: "Cases opened", desc: "Email when a buyer opens a case" },
            { type: "EMAIL_NEW_REVIEW", label: "New reviews", desc: "Email when a buyer leaves a review" },
            { type: "EMAIL_NEW_FOLLOWER", label: "New followers", desc: "Email when someone follows your shop (off by default)" },
          ].map((r) => (
            <div key={r.type} className="flex items-center justify-between py-3 border-b border-neutral-100 last:border-0">
              <div>
                <p className="text-sm font-medium text-neutral-800">{r.label}</p>
                <p className="text-xs text-neutral-400 mt-0.5">{r.desc}</p>
              </div>
              <NotificationToggle type={r.type} enabled={getEmailPref(r.type)} />
            </div>
          ))}
        </div>
      </section>

      {/* Shop Updates / Broadcasts */}
      <section className="card-section p-6 space-y-4">
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



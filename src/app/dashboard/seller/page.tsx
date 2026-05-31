// src/app/dashboard/seller/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { revalidatePath } from "next/cache";
import SellerLocationSection from "@/components/SellerLocationSection";
import VacationModeForm from "./VacationModeForm";
import BroadcastComposer from "@/components/BroadcastComposer";
import SellerShipFromAddressFields from "@/components/SellerShipFromAddressFields";
import ActionForm from "@/components/ActionForm";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };
import StripeLoginButton from "./StripeLoginButton";
import StripeConnectButton from "./StripeConnectButton";
import { NotificationToggle } from "@/components/NotificationToggle";
import { normalizeNotificationPreferences, type NotificationPreferenceKey } from "@/lib/notificationPreferenceKeys";
import { sanitizeText } from "@/lib/sanitize";
import { sanitizeAddressField, sanitizeAddressName, sanitizeOptionalAddressField } from "@/lib/addressFields";
import { ensureUser, isAccountAccessError } from "@/lib/ensureUser";
import { publicSellerShopPath } from "@/lib/publicPaths";
import { parseMoneyInputToCents } from "@/lib/money";
import { safeRateLimit, sellerProfileRatelimit } from "@/lib/ratelimit";
import { revalidateFooterMetrosCache } from "@/lib/footerMetros";

const inputClass =
  "w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300";
const checkboxClass =
  "h-4 w-4 rounded border-neutral-300 text-neutral-900 accent-neutral-900 focus:ring-neutral-300";

function shortText(v: unknown, maxLength: number) {
  const s = typeof v === "string" ? sanitizeText(v).slice(0, maxLength).trim() : "";
  return s || null;
}
function toFloat(v: unknown) {
  const s = typeof v === "string" ? v.trim() : v;
  if (s === "" || s === undefined) return null;
  const n = parseFloat(String(s));
  return Number.isFinite(n) ? n : null;
}

async function updateSellerProfile(_prevState: unknown, formData: FormData) {
  "use server";

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/seller");
  const { success } = await safeRateLimit(sellerProfileRatelimit, userId);
  if (!success) return { ok: false, error: "Too many shop settings updates. Try again shortly." };

  const { seller } = await ensureSeller();

  const city = shortText(formData.get("city"), 100);
  const state = shortText(formData.get("state"), 50);

  // Location (for pickup map)
  const lat = toFloat(formData.get("lat"));
  const lng = toFloat(formData.get("lng"));
  let radiusMeters = toFloat(formData.get("radiusMeters"));
  const publicMapOptIn = String(formData.get("publicMapOptIn") ?? "") === "on";

  // Shipping/tax in dollars
  const shippingFlatRateCents = parseMoneyInputToCents(formData.get("shippingFlatRate"));
  const freeShippingOverCents = parseMoneyInputToCents(formData.get("freeShippingOver"));
  const allowLocalPickup = String(formData.get("allowLocalPickup") ?? "") === "on";
  const useCalculatedShipping = String(formData.get("useCalculatedShipping") ?? "") === "on";

  if (publicMapOptIn) {
    if (!(Number.isFinite(lat as number) && Number.isFinite(lng as number))) {
      return { ok: false, error: "To appear on the public map, set an exact pin location." };
    }
    // exact pin for public map
    radiusMeters = 0;
  }

  // Ship-from address
  const rawShipFromName = formData.get("shipFromName");
  const rawShipFromLine1 = formData.get("shipFromLine1");
  const rawShipFromLine2 = formData.get("shipFromLine2");
  const rawShipFromCity = formData.get("shipFromCity");
  const rawShipFromState = formData.get("shipFromState");
  const rawShipFromPostal = formData.get("shipFromPostal");
  const rawShipFromCountry = formData.get("shipFromCountry");
  const shipFromName = typeof rawShipFromName === "string" ? sanitizeAddressName(rawShipFromName, 100) || null : null;
  const shipFromLine1 = typeof rawShipFromLine1 === "string" ? sanitizeAddressField(rawShipFromLine1, 200) || null : null;
  const shipFromLine2 = typeof rawShipFromLine2 === "string" ? sanitizeOptionalAddressField(rawShipFromLine2, 200) : null;
  const shipFromCity = typeof rawShipFromCity === "string" ? sanitizeAddressField(rawShipFromCity, 100) || null : null;
  const shipFromState = typeof rawShipFromState === "string" ? sanitizeAddressField(rawShipFromState, 50) || null : null;
  const shipFromPostal = typeof rawShipFromPostal === "string" ? sanitizeAddressField(rawShipFromPostal, 20) || null : null;
  const shipFromCountry = (typeof rawShipFromCountry === "string" ? sanitizeAddressField(rawShipFromCountry, 2) : "")?.toUpperCase() || "US";

  // Preferred carriers
  const preferredCarriers = formData.getAll("preferredCarriers").map(String).filter(Boolean);

  // Default package — form accepts inches/lb but DB stores cm/g.
  // Conversions: 1 in = 2.54 cm; 1 lb = 453.592 g.
  const inToCm = (v: number | null) => (v == null ? null : Math.round(v * 2.54 * 10) / 10);
  const lbToG = (v: number | null) => (v == null ? null : Math.round(v * 453.592));
  const defaultPkgLengthCm = inToCm(toFloat(formData.get("defaultPkgLengthIn")));
  const defaultPkgWidthCm = inToCm(toFloat(formData.get("defaultPkgWidthIn")));
  const defaultPkgHeightCm = inToCm(toFloat(formData.get("defaultPkgHeightIn")));
  const defaultPkgWeightGrams = (() => {
    const raw = toFloat(formData.get("defaultPkgWeightLb"));
    if (raw == null) return null;
    return lbToG(raw);
  })();

  await prisma.sellerProfile.update({
    where: { id: seller.id },
    data: {
      city,
      state,
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
    },
  });

  // Assign metro geography when lat/lng is set — non-fatal
  if (lat != null && lng != null) {
    try {
      const { findOrCreateMetro } = await import("@/lib/geo-metro");
      const { metroId, cityMetroId } = await findOrCreateMetro(lat, lng);
      await prisma.sellerProfile.update({ where: { id: seller.id }, data: { metroId, cityMetroId } });
      revalidateFooterMetrosCache();
    } catch (e) {
      console.error("[geo-metro] Failed to assign metro to seller profile:", e);
    }
  }

  revalidatePath(`/seller/${seller.id}`);
  revalidatePath("/dashboard/seller");
  return { ok: true };
}

export default async function SellerSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe_return?: string | string[]; onboarded?: string | string[] }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/seller");

  let seller: Awaited<ReturnType<typeof ensureSeller>>["seller"];
  let me: Awaited<ReturnType<typeof ensureUser>>;
  try {
    ({ seller } = await ensureSeller());
    me = await ensureUser();
  } catch (error) {
    if (isAccountAccessError(error)) redirect("/banned");
    throw error;
  }
  if (!me) redirect("/sign-in?redirect_url=/dashboard/seller");

  const [row, followerCount, draftCount, userRow, latestPayoutFailure] = await Promise.all([
    prisma.sellerProfile.findUnique({ where: { id: seller.id } }),
    prisma.follow.count({ where: { sellerProfileId: seller.id } }),
    prisma.listing.count({ where: { sellerId: seller.id, status: "DRAFT" } }),
    prisma.user.findUnique({ where: { id: me.id }, select: { notificationPreferences: true } }),
    prisma.sellerPayoutEvent.findFirst({
      where: {
        sellerProfileId: seller.id,
        status: "failed",
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, failureMessage: true, amountCents: true, currency: true },
    }),
  ]);

  const stripeParams = await searchParams;
  let currentRow = row;
  if ((stripeParams.stripe_return != null || stripeParams.onboarded != null) && currentRow?.stripeAccountId) {
    try {
      const { stripe } = await import("@/lib/stripe");
      const account = await stripe.accounts.retrieve(currentRow.stripeAccountId);
      const chargesEnabled = account.charges_enabled ?? false;
      if (chargesEnabled !== currentRow.chargesEnabled) {
        await prisma.sellerProfile.update({
          where: { id: seller.id },
          data: { chargesEnabled },
        });
        currentRow = { ...currentRow, chargesEnabled };
      }
    } catch (error) {
      console.error("[stripe-connect] Failed to refresh seller account status:", error);
    }
  }

  const prefs = normalizeNotificationPreferences(userRow?.notificationPreferences);
  const SELLER_DEFAULT_OFF: NotificationPreferenceKey[] = ["NEW_FAVORITE", "NEW_BLOG_COMMENT", "BLOG_COMMENT_REPLY"];
  function isEnabled(type: NotificationPreferenceKey) {
    if (SELLER_DEFAULT_OFF.includes(type)) return prefs[type] === true;
    return prefs[type] !== false;
  }
  function getEmailPref(key: NotificationPreferenceKey): boolean {
    if (key in prefs) return prefs[key] as boolean;
    return true;
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold font-display">Shop Settings</h1>

      {/* Payouts & Banking */}
      <section className="card-section p-6 space-y-3">
        <h2 className="font-display text-xl font-semibold">Payouts & Banking</h2>
        <p className="text-sm text-neutral-500">
          View your balance, payout history, and update your bank account in your Stripe dashboard.
        </p>
        {latestPayoutFailure && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-800">Stripe payout failed</p>
            <p className="mt-1 text-sm text-red-700">
              {latestPayoutFailure.failureMessage ??
                "Stripe could not complete a payout. Review your Stripe account so the payout can be retried."}{" "}
              Last reported{" "}
              {latestPayoutFailure.createdAt.toLocaleDateString("en-US")}.
            </p>
          </div>
        )}
        {currentRow?.chargesEnabled && currentRow?.stripeAccountId ? (
          <div className="space-y-3">
            <p className="text-sm text-green-700 font-medium">✓ Stripe Connected</p>
            <StripeLoginButton hasStripeAccount={true} />
            {draftCount > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-sm text-amber-800 font-medium">
                  You have {draftCount} draft {draftCount === 1 ? "listing" : "listings"} ready to activate.
                </p>
                <a
                  href={`${publicSellerShopPath(seller.id, seller.displayName)}?status=DRAFT`}
                  className="text-sm text-amber-700 underline"
                >
                  Go to My Shop to publish →
                </a>
              </div>
            )}
          </div>
        ) : currentRow?.stripeAccountId && !currentRow?.chargesEnabled ? (
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
        vacationMode={currentRow?.vacationMode ?? false}
        vacationReturnDate={currentRow?.vacationReturnDate ?? null}
        vacationMessage={currentRow?.vacationMessage ?? null}
      />

      <ActionForm action={updateSellerProfile} className="card-section space-y-6 p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">City</label>
            <input
              name="city"
              autoComplete="address-level2"
              defaultValue={currentRow?.city ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">State</label>
            <input
              name="state"
              autoComplete="address-level1"
              defaultValue={currentRow?.state ?? ""}
              className={inputClass}
            />
          </div>
        </div>

        {/* Location picker */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">Pickup location</label>
          <SellerLocationSection
            defaultLat={currentRow?.lat != null ? Number(currentRow.lat) : null}
            defaultLng={currentRow?.lng != null ? Number(currentRow.lng) : null}
            defaultRadiusMeters={currentRow?.radiusMeters ?? null}
            defaultPublicMapOptIn={currentRow?.publicMapOptIn ?? false}
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
              type="text"
              inputMode="decimal"
              pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
              name="shippingFlatRate"
              autoComplete="off"
              defaultValue={currentRow?.shippingFlatRateCents != null ? (currentRow.shippingFlatRateCents / 100).toFixed(2) : ""}
              className={inputClass}
              placeholder="e.g. 7.00"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Free shipping over ($)</label>
            <input
              type="text"
              inputMode="decimal"
              pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
              name="freeShippingOver"
              autoComplete="off"
              defaultValue={currentRow?.freeShippingOverCents != null ? (currentRow.freeShippingOverCents / 100).toFixed(2) : ""}
              className={inputClass}
              placeholder="e.g. 50.00"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="allowLocalPickup"
              name="allowLocalPickup"
              type="checkbox"
              defaultChecked={currentRow?.allowLocalPickup ?? false}
              className={checkboxClass}
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
              defaultChecked={currentRow?.useCalculatedShipping ?? false}
              className={checkboxClass}
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
                  defaultChecked={currentRow?.preferredCarriers?.includes(c)}
                  className={checkboxClass}
                />
                {c}
              </label>
            ))}
          </div>
        </div>

        <div className="border-t border-neutral-100 pt-4 space-y-3">
          <h2 className="text-lg font-semibold font-display">Ship from address</h2>
          <SellerShipFromAddressFields defaults={currentRow ?? {}} />
        </div>

        {/* Default package size — inputs in inches/lb; converted to cm/g
            server-side because Shippo + the DB store metric. */}
        <div className="border-t border-neutral-100 pt-4 space-y-3">
          <h2 className="text-lg font-semibold font-display">Default package size</h2>
          <p className="text-xs text-neutral-500">
            Used for live carrier quotes when a listing doesn&apos;t specify its own packaged dimensions and weight.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input
              name="defaultPkgLengthIn"
              type="number"
              inputMode="decimal"
              step="0.1"
              placeholder="Length (in)"
              autoComplete="off"
              defaultValue={
                currentRow?.defaultPkgLengthCm != null
                  ? Math.round((currentRow.defaultPkgLengthCm / 2.54) * 10) / 10
                  : ""
              }
              className={inputClass}
            />
            <input
              name="defaultPkgWidthIn"
              type="number"
              inputMode="decimal"
              step="0.1"
              placeholder="Width (in)"
              autoComplete="off"
              defaultValue={
                currentRow?.defaultPkgWidthCm != null
                  ? Math.round((currentRow.defaultPkgWidthCm / 2.54) * 10) / 10
                  : ""
              }
              className={inputClass}
            />
            <input
              name="defaultPkgHeightIn"
              type="number"
              inputMode="decimal"
              step="0.1"
              placeholder="Height (in)"
              autoComplete="off"
              defaultValue={
                currentRow?.defaultPkgHeightCm != null
                  ? Math.round((currentRow.defaultPkgHeightCm / 2.54) * 10) / 10
                  : ""
              }
              className={inputClass}
            />
            <input
              name="defaultPkgWeightLb"
              type="number"
              inputMode="decimal"
              step="0.1"
              placeholder="Weight (lb)"
              autoComplete="off"
              defaultValue={
                currentRow?.defaultPkgWeightGrams != null
                  ? Math.round((currentRow.defaultPkgWeightGrams / 453.592) * 10) / 10
                  : ""
              }
              className={inputClass}
            />
          </div>
        </div>

        <button type="submit" className="rounded-md px-4 py-2.5 bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800">
          Save settings
        </button>
      </ActionForm>

      {/* Shop Notifications */}
      <section className="card-section p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold font-display">Shop Notifications</h2>
          <p className="text-sm text-neutral-500 mt-1">Notifications about your shop and listings.</p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">In-app</h3>
          {([
            { type: "NEW_MESSAGE", label: "New messages", desc: "When someone sends you a message" },
            { type: "NEW_REVIEW", label: "New reviews", desc: "When a buyer leaves a review" },
            { type: "NEW_FOLLOWER", label: "New followers", desc: "When someone follows your shop" },
            { type: "CUSTOM_ORDER_REQUEST", label: "Custom order requests", desc: "When a buyer requests a custom piece" },
            { type: "NEW_FAVORITE", label: "Someone saves your listing", desc: "When a buyer hearts one of your pieces (off by default)" },
            { type: "CASE_OPENED", label: "Cases opened", desc: "When a buyer opens a case on one of your orders" },
            { type: "REFUND_ISSUED", label: "Refunds issued", desc: "When a refund is issued on an order" },
            { type: "PAYMENT_DISPUTE", label: "Payment disputes", desc: "When Stripe opens or updates a dispute" },
            { type: "NEW_BLOG_COMMENT", label: "Blog comments", desc: "When someone comments on your blog post (off by default)" },
            { type: "BLOG_COMMENT_REPLY", label: "Blog replies", desc: "When someone replies to your comment (off by default)" },
            { type: "LISTING_APPROVED", label: "Listing approved", desc: "When a listing passes review and goes live" },
            { type: "LISTING_REJECTED", label: "Listing rejected", desc: "When a listing needs changes before it can go live" },
            { type: "VERIFICATION_APPROVED", label: "Verification approved", desc: "When a Guild application is approved" },
            { type: "VERIFICATION_REJECTED", label: "Verification rejected", desc: "When a Guild application or badge is rejected or revoked" },
            { type: "LOW_STOCK", label: "Low stock", desc: "When an in-stock listing is running low" },
            { type: "LISTING_FLAGGED_BY_USER", label: "Listing reports", desc: "When a report about one of your listings is received" },
            { type: "ACCOUNT_WARNING", label: "Account warnings", desc: "Important account notices from Grainline" },
            { type: "PAYOUT_FAILED", label: "Payout failures", desc: "When Stripe reports a failed payout" },
          ] satisfies Array<{ type: NotificationPreferenceKey; label: string; desc: string }>).map((r) => (
            <div key={r.type} className="flex items-center justify-between py-3 border-b border-neutral-100 last:border-0">
              <div>
                <p className="text-sm font-medium text-neutral-800">{r.label}</p>
                <p className="text-xs text-neutral-500 mt-0.5">{r.desc}</p>
              </div>
              <NotificationToggle type={r.type} enabled={isEnabled(r.type)} />
            </div>
          ))}
        </div>

        <div className="border-t border-neutral-100 pt-4">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">Email</h3>
          {([
            { type: "EMAIL_NEW_ORDER", label: "New orders", desc: "Email when a buyer purchases from your shop" },
            { type: "EMAIL_CUSTOM_ORDER", label: "Custom order requests", desc: "Email when a buyer sends you a custom order request" },
            { type: "EMAIL_CASE_OPENED", label: "Cases opened", desc: "Email when a buyer opens a case" },
            { type: "EMAIL_NEW_REVIEW", label: "New reviews", desc: "Email when a buyer leaves a review" },
            { type: "EMAIL_VERIFICATION_APPROVED", label: "Verification approved", desc: "Email when a Guild application is approved" },
            { type: "EMAIL_VERIFICATION_REJECTED", label: "Verification rejected", desc: "Email when a Guild application or badge is rejected or revoked" },
          ] satisfies Array<{ type: NotificationPreferenceKey; label: string; desc: string }>).map((r) => (
            <div key={r.type} className="flex items-center justify-between py-3 border-b border-neutral-100 last:border-0">
              <div>
                <p className="text-sm font-medium text-neutral-800">{r.label}</p>
                <p className="text-xs text-neutral-500 mt-0.5">{r.desc}</p>
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

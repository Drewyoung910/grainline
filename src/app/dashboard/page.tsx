// src/app/dashboard/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { ListingStatus } from "@prisma/client";
import ConfirmButton from "@/components/ConfirmButton";
import { Store, Package, Tag, MessageCircle, User, Grid, Edit, Sparkles, Bell, BarChart, Eye, Heart } from "@/components/icons";
import { softDeleteListingWithCleanup } from "@/lib/listingSoftDelete";
import DismissibleBanner from "@/components/DismissibleBanner";
import ResubmitButton from "@/components/ResubmitButton";
import { safeRateLimit, savedSearchRatelimit } from "@/lib/ratelimit";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Server action: set status (Active / Hidden / Sold)
async function setStatus(listingId: string, nextStatus: ListingStatus) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  // ensure ownership
  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) return;
  if (me.banned || me.deletedAt) return;

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { seller: true },
  });
  if (!listing || listing.seller.userId !== me.id) return;
  if (listing.status === "HIDDEN" && listing.isPrivate) return;

  // Seller-initiated reactivation must go through publishListingAction so AI/admin
  // moderation cannot be bypassed by forged server-action posts.
  if (nextStatus === "ACTIVE") return;
  if (listing.status === "REJECTED" && nextStatus === "HIDDEN") return;

  await prisma.listing.update({
    where: { id: listingId },
    data: { status: nextStatus },
  });

  // Update listingsBelowThresholdSince for Guild Member revocation tracking
  const activeCount = await prisma.listing.count({
    where: { sellerId: listing.sellerId, status: "ACTIVE" },
  });
  const sp = await prisma.sellerProfile.findUnique({
    where: { id: listing.sellerId },
    select: { listingsBelowThresholdSince: true },
  });
  if (sp) {
    if (activeCount < 5 && !sp.listingsBelowThresholdSince) {
      await prisma.sellerProfile.update({
        where: { id: listing.sellerId },
        data: { listingsBelowThresholdSince: new Date() },
      });
    } else if (activeCount >= 5 && sp.listingsBelowThresholdSince) {
      await prisma.sellerProfile.update({
        where: { id: listing.sellerId },
        data: { listingsBelowThresholdSince: null },
      });
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/browse");
}

// Server action: delete listing
async function deleteListing(listingId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) return;
  if (me.banned || me.deletedAt) return;

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { seller: true },
  });
  if (!listing || listing.seller.userId !== me.id) return;

  // Archive: preserve order history, remove current shopping intent records.
  try {
    await softDeleteListingWithCleanup(listingId);
  } catch (err) {
    console.error("Archive listing failed:", err);
    return;
  }

  // Deleting a listing may drop active count below 5
  const activeCount = await prisma.listing.count({
    where: { sellerId: listing.sellerId, status: "ACTIVE" },
  });
  const sp = await prisma.sellerProfile.findUnique({
    where: { id: listing.sellerId },
    select: { listingsBelowThresholdSince: true },
  });
  if (sp && activeCount < 5 && !sp.listingsBelowThresholdSince) {
    await prisma.sellerProfile.update({
      where: { id: listing.sellerId },
      data: { listingsBelowThresholdSince: new Date() },
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/browse");
}

async function deleteSavedSearch(searchId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;
  const { success } = await safeRateLimit(savedSearchRatelimit, `dashboard-delete:${userId}`);
  if (!success) return;
  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true, banned: true, deletedAt: true } });
  if (!me) return;
  if (me.banned || me.deletedAt) return;
  await prisma.savedSearch.deleteMany({ where: { id: searchId, userId: me.id } });
  revalidatePath("/dashboard");
}

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard");

  const { me, seller } = await ensureSeller();

  // Check if this user actually has an existing seller profile (ensureSeller creates one if absent,
  // so we check onboardingComplete to distinguish first-time sellers from pure buyers who stumbled here).
  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { id: seller.id },
    select: { onboardingComplete: true },
  });

  // Redirect new sellers (onboardingComplete = false) to the setup wizard
  if (sellerProfile && !sellerProfile.onboardingComplete) {
    redirect("/dashboard/onboarding");
  }

  const [listings, savedSearches, verification, notifUnreadCount, guildSeller] = await Promise.all([
    prisma.listing.findMany({
      where: { sellerId: seller.id },
      select: {
        id: true,
        title: true,
        priceCents: true,
        currency: true,
        status: true,
        isPrivate: true,
        viewCount: true,
        clickCount: true,
        aiReviewFlags: true,
        reviewedByAdmin: true,
        createdAt: true,
        updatedAt: true,
        photos: { orderBy: { sortOrder: "asc" }, take: 1 },
        _count: { select: { favorites: true, stockNotifications: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    prisma.savedSearch.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.makerVerification.findUnique({
      where: { sellerProfileId: seller.id },
      select: { status: true },
    }),
    prisma.notification.count({ where: { userId: me.id, read: false } }),
    prisma.sellerProfile.findUnique({
      where: { id: seller.id },
      select: { guildLevel: true, vacationMode: true, vacationReturnDate: true, chargesEnabled: true },
    }),
  ]);
  const guildLevel = guildSeller?.guildLevel ?? "NONE";
  const vacationMode = guildSeller?.vacationMode ?? false;
  const vacationReturnDate = guildSeller?.vacationReturnDate ?? null;
  const chargesEnabled = guildSeller?.chargesEnabled ?? false;

  return (
    <main className="max-w-7xl mx-auto p-8">
      <header className="mb-10">
        <h1 className="text-4xl font-bold font-display">
          Workshop — {me.name ?? me.email.split("@")[0]}
        </h1>
        <p className="text-neutral-600 mt-2">Signed in as {me.email}</p>

        {/* ── Your Shop ── */}
        <div className="mt-8">
          <p className="text-sm font-medium text-stone-500 uppercase tracking-wide mb-3">Your Shop</p>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
            <Link
              href="/dashboard/listings/new"
              className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 px-4 py-3 sm:py-2 text-sm font-medium hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
            >
              <Store size={20} className="sm:hidden shrink-0" />
              <Store size={16} className="hidden sm:block shrink-0" />
              Create listing
            </Link>

            <Link
              href="/dashboard/profile"
              className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 px-4 py-3 sm:py-2 text-sm font-medium hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
            >
              <User size={20} className="sm:hidden shrink-0" />
              <User size={16} className="hidden sm:block shrink-0" />
              Shop Profile
            </Link>

            <Link
              href="/dashboard/seller"
              className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 px-4 py-3 sm:py-2 text-sm font-medium hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
            >
              <Package size={20} className="sm:hidden shrink-0" />
              <Package size={16} className="hidden sm:block shrink-0" />
              Shipping &amp; Settings
            </Link>

            <Link
              href="/dashboard/sales"
              className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 px-4 py-3 sm:py-2 text-sm font-medium hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
            >
              <Tag size={20} className="sm:hidden shrink-0" />
              <Tag size={16} className="hidden sm:block shrink-0" />
              My sales
            </Link>

            <Link
              href="/dashboard/inventory"
              className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 px-4 py-3 sm:py-2 text-sm font-medium hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
            >
              <Grid size={20} className="sm:hidden shrink-0" />
              <Grid size={16} className="hidden sm:block shrink-0" />
              Inventory
            </Link>

            <Link
              href="/dashboard/analytics"
              className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 px-4 py-3 sm:py-2 text-sm font-medium hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
            >
              <BarChart size={20} className="sm:hidden shrink-0" />
              <BarChart size={16} className="hidden sm:block shrink-0" />
              Analytics
            </Link>

            <Link
              href="/dashboard/blog"
              className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 px-4 py-3 sm:py-2 text-sm font-medium hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
            >
              <Edit size={20} className="sm:hidden shrink-0" />
              <Edit size={16} className="hidden sm:block shrink-0" />
              My Blog
            </Link>

            {guildLevel === "GUILD_MASTER" ? (
              <Link
                href="/dashboard/verification"
                className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 !border-indigo-300 !bg-indigo-50 px-4 py-3 sm:py-2 text-sm font-medium text-indigo-800 hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
              >
                <Sparkles size={20} className="sm:hidden shrink-0" />
                <Sparkles size={16} className="hidden sm:block shrink-0" />
                Guild Master
              </Link>
            ) : guildLevel === "GUILD_MEMBER" ? (
              <Link
                href="/dashboard/verification"
                className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 !border-amber-300 !bg-amber-50 px-4 py-3 sm:py-2 text-sm font-medium text-amber-800 hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
              >
                <Sparkles size={20} className="sm:hidden shrink-0" />
                <Sparkles size={16} className="hidden sm:block shrink-0" />
                Guild Member
              </Link>
            ) : (
              <Link
                href="/dashboard/verification"
                className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 px-4 py-3 sm:py-2 text-sm font-medium hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
              >
                <Sparkles size={20} className="sm:hidden shrink-0" />
                <Sparkles size={16} className="hidden sm:block shrink-0" />
                {verification?.status === "PENDING" ? "Guild Badge Pending" : "Apply for Guild Badge"}
              </Link>
            )}
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="border-t border-stone-200/60 my-6" />

        {/* ── Your Account ── */}
        <div>
          <p className="text-sm font-medium text-stone-500 uppercase tracking-wide mb-3">Your Account</p>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
            <Link
              href="/dashboard/orders"
              className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 px-4 py-3 sm:py-2 text-sm font-medium hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
            >
              <Package size={20} className="sm:hidden shrink-0" />
              <Package size={16} className="hidden sm:block shrink-0" />
              My orders
            </Link>

            <Link
              href="/messages"
              className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 px-4 py-3 sm:py-2 text-sm font-medium hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
            >
              <MessageCircle size={20} className="sm:hidden shrink-0" />
              <MessageCircle size={16} className="hidden sm:block shrink-0" />
              Messages
            </Link>

            <Link
              href="/dashboard/notifications"
              className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 px-4 py-3 sm:py-2 text-sm font-medium hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
            >
              <Bell size={20} className="sm:hidden shrink-0" />
              <Bell size={16} className="hidden sm:block shrink-0" />
              Notifications
              {notifUnreadCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-medium leading-none text-white">
                  {notifUnreadCount}
                </span>
              )}
            </Link>

            <Link
              href="/account/saved"
              className="card-section flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 px-4 py-3 sm:py-2 text-sm font-medium hover:shadow-md transition-shadow min-h-[56px] sm:min-h-0 text-center sm:text-left"
            >
              Saved items
            </Link>
          </div>
        </div>

        <p className="mt-4 text-sm text-stone-400">
          <Link href="/browse" className="hover:text-stone-600 hover:underline">← Back to browsing</Link>
        </p>
      </header>

      {/* Stripe Connect banner */}
      {!chargesEnabled && (
        <div className="bg-amber-50 border border-amber-200 p-4 mb-6 flex items-center justify-between">
          <div>
            <p className="font-medium text-amber-900 text-sm">Your listings are not visible to buyers yet</p>
            <p className="text-amber-700 text-xs mt-0.5">Connect Stripe to receive payments and make your listings public</p>
          </div>
          <Link href="/dashboard/seller" className="text-xs font-medium text-amber-900 underline whitespace-nowrap ml-4">
            Connect Stripe →
          </Link>
        </div>
      )}

      {/* Vacation mode active banner */}
      {vacationMode && (
        <div className="mb-8 border border-amber-300 bg-amber-50 px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-amber-900 text-sm">Vacation mode is active</p>
            <p className="text-amber-800 text-sm mt-0.5">
              Your listings are hidden and new orders are blocked.
              {vacationReturnDate && (
                <> Return date: {new Date(vacationReturnDate).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.</>
              )}
              {!vacationReturnDate && <> No return date set.</>}
            </p>
          </div>
          <a
            href="/dashboard/seller"
            className="shrink-0 text-xs border border-amber-400 bg-white px-3 py-1.5 text-amber-900 hover:bg-amber-100 transition-colors"
          >
            Turn off vacation mode →
          </a>
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold font-display">My Listings</h2>
          <Link
            href={`/seller/${seller.id}/shop`}
            className="text-sm text-neutral-600 underline hover:text-neutral-900"
          >
            View My Shop →
          </Link>
        </div>

        {listings.some((l) => l.status === "PENDING_REVIEW") && (
          <div className="mb-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 rounded-md">
            <span className="font-medium">Some listings are under review.</span>{" "}Our team will approve them shortly. You&apos;ll be notified when they go live.
          </div>
        )}

        {listings.some((l) => l.status === "REJECTED") && (
          <DismissibleBanner
            className="mb-4 border border-red-200 bg-red-50 px-4 py-3 pr-8 text-sm text-red-900 rounded-md"
            rejectedIds={listings.filter((l) => l.status === "REJECTED").map((l) => l.id)}
          >
            <span className="font-medium">Some listings were rejected.</span> Edit and resubmit them for review.
          </DismissibleBanner>
        )}

        {listings.length === 0 ? (
          <div className="card-section p-8 text-neutral-600">
            Your workshop is empty — list your first piece and start selling.
          </div>
        ) : (
          <ul className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 lg:grid-cols-3 sm:gap-6">
            {listings.map((l) => {
              const thumb = l.photos[0]?.url;
              const isArchived = l.status === "HIDDEN" && l.isPrivate;

              return (
                <li key={l.id} className="card-listing min-w-[220px] flex-none snap-start sm:min-w-0">
                  {l.status !== "DRAFT" && !isArchived ? (
                    <Link href={`/listing/${l.id}`} className="block">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt={l.title} className="h-48 w-full object-cover" />
                      ) : (
                        <div className="h-48 w-full bg-neutral-100" />
                      )}
                    </Link>
                  ) : (
                    <>
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt={l.title} className="h-48 w-full object-cover" />
                      ) : (
                        <div className="h-48 w-full bg-neutral-100" />
                      )}
                    </>
                  )}

                  <div className="p-4 space-y-2">
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-medium">
                        {l.status !== "DRAFT" && !isArchived ? (
                          <Link href={`/listing/${l.id}`} className="hover:underline">{l.title}</Link>
                        ) : l.title}
                      </h3>
                      <span className="text-sm text-neutral-500">
                        {(l.priceCents / 100).toLocaleString(undefined, {
                          style: "currency",
                          currency: l.currency,
                        })}
                      </span>
                    </div>

                    <div className="text-xs uppercase tracking-wide text-neutral-500">
                      {isArchived ? (
                        <span className="inline-block px-2 py-0.5 bg-neutral-100 text-neutral-700 rounded-full font-medium normal-case">
                          Archived
                        </span>
                      ) : l.status === "PENDING_REVIEW" ? (
                        <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full font-medium normal-case">
                          Under Review
                        </span>
                      ) : l.status === "REJECTED" ? (
                        <span className="inline-block px-2 py-0.5 bg-red-100 text-red-800 rounded-full font-medium normal-case">
                          Rejected
                        </span>
                      ) : l.status}
                    </div>

                    <div className="text-xs text-neutral-400 flex items-center gap-1 flex-wrap">
                      <Eye size={11} className="inline align-middle" /> {l.viewCount} · clicks {l.clickCount} · <Heart size={11} className="inline align-middle" /> {l._count.favorites} · <Bell size={11} className="inline align-middle" /> {l._count.stockNotifications}
                    </div>

                    <div className="pt-3 flex flex-wrap gap-2">
                      {!isArchived && (
                        <>
                          <Link
                            href={`/dashboard/listings/${l.id}/edit`}
                            className="text-xs rounded border border-neutral-200 px-2 py-1 hover:bg-neutral-50"
                          >
                            Edit
                          </Link>
                          {(l.status === "DRAFT" || l.status === "HIDDEN" || l.status === "PENDING_REVIEW" || l.status === "REJECTED") && (
                            <Link
                              href={`/listing/${l.id}?preview=1`}
                              className="text-xs rounded border border-neutral-200 px-2 py-1 hover:bg-neutral-50"
                              target="_blank"
                            >
                              Preview →
                            </Link>
                          )}
                        </>
                      )}

                      {!isArchived && l.status === "REJECTED" && (
                        <ResubmitButton listingId={l.id} />
                      )}

                      {/* REJECTED: only Edit + Resubmit + Delete — no Hide/Unhide/Mark sold */}
                      {!isArchived && l.status !== "REJECTED" && l.status !== "PENDING_REVIEW" && (
                        <>
                          {/* Mark sold only for ACTIVE and SOLD_OUT — not DRAFT or HIDDEN */}
                          {(l.status === "ACTIVE" || l.status === "SOLD_OUT") && (
                            <form action={setStatus.bind(null, l.id, ListingStatus.SOLD)}>
                              <button className="text-xs rounded border border-neutral-200 px-2 py-1 hover:bg-neutral-50">
                                Mark sold
                              </button>
                            </form>
                          )}

                          {l.status === "HIDDEN" ? (
                            <ResubmitButton listingId={l.id} label="Unhide" />
                          ) : l.status !== "DRAFT" ? (
                            <form action={setStatus.bind(null, l.id, ListingStatus.HIDDEN)}>
                              <button className="text-xs rounded border border-neutral-200 px-2 py-1 hover:bg-neutral-50">
                                Hide
                              </button>
                            </form>
                          ) : null}
                        </>
                      )}

                      <form action={deleteListing.bind(null, l.id)}>
                        <ConfirmButton
                          confirm="Archive this listing? It will be removed from public pages and current carts, but retained for order history."
                          disabled={isArchived}
                          className="text-xs rounded border px-2 py-1 hover:bg-red-50 text-red-600 border-red-300"
                        >
                          {isArchived ? "Archived" : "Archive"}
                        </ConfirmButton>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Saved Searches */}
      <section className="mt-10">
        <h2 className="text-xl font-semibold font-display mb-4">Saved Searches</h2>
        {savedSearches.length === 0 ? (
          <div className="card-section p-6 text-neutral-600 text-sm">
            No saved searches yet.{" "}<Link href="/browse" className="underline">Browse listings</Link>{" "}and click &quot;Save search&quot; to save a search.
          </div>
        ) : (
          <ul className="space-y-2">
            {savedSearches.map((s) => {
              const parts: string[] = [];
              if (s.query) parts.push(`"${s.query}"`);
              if (s.category) parts.push(s.category.charAt(0) + s.category.slice(1).toLowerCase());
              if (s.listingType) parts.push(s.listingType === "IN_STOCK" ? "In stock" : "Made to order");
              if (s.shipsWithinDays != null) parts.push(`ships within ${s.shipsWithinDays}d`);
              if (s.minRating != null) parts.push(`${s.minRating}★+`);
              if (s.minPrice != null) parts.push(`$${(s.minPrice / 100).toFixed(0)}+`);
              if (s.maxPrice != null) parts.push(`up to $${(s.maxPrice / 100).toFixed(0)}`);
              if (s.lat != null && s.lng != null && s.radiusMiles != null) parts.push(`within ${s.radiusMiles} mi`);
              if (s.tags.length > 0) parts.push(s.tags.map((t) => `#${t}`).join(" "));

              const href = (() => {
                const p = new URLSearchParams();
                if (s.query) p.set("q", s.query);
                if (s.category) p.set("category", s.category);
                if (s.listingType) p.set("type", s.listingType);
                if (s.shipsWithinDays != null) p.set("ships", String(s.shipsWithinDays));
                if (s.minRating != null) p.set("rating", String(s.minRating));
                if (s.lat != null && s.lng != null && s.radiusMiles != null) {
                  p.set("lat", String(s.lat));
                  p.set("lng", String(s.lng));
                  p.set("radius", String(s.radiusMiles));
                }
                if (s.sort) p.set("sort", s.sort);
                if (s.minPrice != null) p.set("min", (s.minPrice / 100).toFixed(2));
                if (s.maxPrice != null) p.set("max", (s.maxPrice / 100).toFixed(2));
                for (const t of s.tags) p.append("tag", t);
                return `/browse?${p.toString()}`;
              })();

              return (
                <li key={s.id} className="flex items-center justify-between card-section px-4 py-3">
                  <div className="min-w-0">
                    <Link href={href} className="text-sm font-medium hover:underline">
                      {parts.length > 0 ? parts.join(" · ") : "All listings"}
                    </Link>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      Saved {new Date(s.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Link
                      href={href}
                      className="rounded border px-3 py-1 text-xs hover:bg-neutral-50"
                    >
                      Browse
                    </Link>
                    <form action={deleteSavedSearch.bind(null, s.id)}>
                      <button className="rounded border px-3 py-1 text-xs text-red-600 border-red-200 hover:bg-red-50">
                        Delete
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}









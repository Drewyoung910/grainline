// src/app/account/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUser } from "@/lib/ensureUser";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Account",
};

export default async function AccountPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account");

  const me = await ensureUser();
  if (!me) redirect("/sign-in?redirect_url=/account");

  const [recentOrders, savedItems, followCount, sellerProfile] = await Promise.all([
    // Most recent 5 orders as a buyer
    prisma.order.findMany({
      where: { buyerId: me.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        createdAt: true,
        itemsSubtotalCents: true,
        shippingAmountCents: true,
        taxAmountCents: true,
        currency: true,
        fulfillmentStatus: true,
        items: {
          take: 1,
          select: {
            priceCents: true,
            listing: {
              select: {
                id: true,
                title: true,
                photos: {
                  take: 1,
                  orderBy: { sortOrder: "asc" },
                  select: { url: true },
                },
              },
            },
          },
        },
      },
    }),

    // Most recent 6 saved (favorited) listings
    prisma.favorite.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        listing: {
          select: {
            id: true,
            title: true,
            priceCents: true,
            currency: true,
            photos: {
              take: 1,
              orderBy: { sortOrder: "asc" },
              select: { url: true },
            },
            seller: {
              select: { displayName: true },
            },
          },
        },
      },
    }),

    // Follow count
    prisma.follow.count({ where: { followerId: me.id } }),

    // Seller profile stats (if they're a seller)
    prisma.sellerProfile.findUnique({
      where: { userId: me.id },
      select: {
        id: true,
        onboardingComplete: true,
        _count: {
          select: {
            listings: { where: { status: "ACTIVE" } },
          },
        },
      },
    }),
  ]);

  // Completed order count for sellers
  let completedOrderCount = 0;
  if (sellerProfile) {
    completedOrderCount = await prisma.order.count({
      where: {
        items: { some: { listing: { sellerId: sellerProfile.id } } },
        fulfillmentStatus: { in: ["DELIVERED", "PICKED_UP"] },
      },
    });
  }

  function formatStatus(status: string | null) {
    if (!status) return "Pending";
    switch (status) {
      case "PENDING": return "Processing";
      case "READY_FOR_PICKUP": return "Ready for Pickup";
      case "PICKED_UP": return "Picked Up";
      case "SHIPPED": return "Shipped";
      case "DELIVERED": return "Delivered";
      default: return status;
    }
  }

  function statusColor(status: string | null) {
    switch (status) {
      case "DELIVERED":
      case "PICKED_UP":
        return "bg-green-100 text-green-800";
      case "SHIPPED":
        return "bg-blue-100 text-blue-800";
      case "READY_FOR_PICKUP":
        return "bg-amber-100 text-amber-800";
      default:
        return "bg-neutral-100 text-neutral-700";
    }
  }

  return (
    <main className="max-w-4xl mx-auto p-6 md:p-8 space-y-10">
      {/* ── Header ── */}
      <header className="flex items-center gap-4">
        {me.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={me.imageUrl}
            alt={me.name ?? ""}
            className="h-14 w-14 rounded-full object-cover border"
          />
        )}
        <div>
          <h1 className="text-3xl font-bold">My Account</h1>
          <p className="text-neutral-500 text-sm mt-0.5">{me.email}</p>
        </div>
      </header>

      {/* ── Section 1: Recent Orders ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">My Orders</h2>
          <Link href="/account/orders" className="text-sm text-neutral-600 underline hover:text-neutral-900">
            View all orders →
          </Link>
        </div>

        {recentOrders.length === 0 ? (
          <div className="border border-neutral-200 p-6 text-neutral-600 text-sm space-y-2">
            <p>No orders yet.</p>
            <Link href="/browse" className="underline hover:text-neutral-900">
              Start browsing →
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {recentOrders.map((order) => {
              const firstItem = order.items[0];
              const thumb = firstItem?.listing.photos[0]?.url;
              const total =
                order.itemsSubtotalCents + order.shippingAmountCents + order.taxAmountCents;

              return (
                <li key={order.id} className="border border-neutral-200 flex items-center gap-4 p-3 hover:bg-neutral-50 transition-colors">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-14 w-14 object-cover border border-neutral-200 shrink-0" />
                  ) : (
                    <div className="h-14 w-14 bg-neutral-100 border border-neutral-200 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {firstItem?.listing.title ?? "Order"}
                    </p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {new Date(order.createdAt).toLocaleDateString()} ·{" "}
                      {(total / 100).toLocaleString(undefined, {
                        style: "currency",
                        currency: order.currency,
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(order.fulfillmentStatus)}`}>
                      {formatStatus(order.fulfillmentStatus)}
                    </span>
                    <Link
                      href={`/dashboard/orders/${order.id}`}
                      className="text-xs border border-neutral-200 px-2 py-1 hover:bg-neutral-50"
                    >
                      View
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Section 2: Saved Items ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Saved Items</h2>
          <Link href="/account/saved" className="text-sm text-neutral-600 underline hover:text-neutral-900">
            View all saved →
          </Link>
        </div>

        {savedItems.length === 0 ? (
          <div className="border border-neutral-200 p-6 text-neutral-600 text-sm">
            No saved items yet. Heart pieces while browsing to save them here.
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {savedItems.map(({ listing }) => {
              const thumb = listing.photos[0]?.url;
              return (
                <Link
                  key={listing.id}
                  href={`/listing/${listing.id}`}
                  className="border border-neutral-200 hover:bg-neutral-50 shrink-0 w-40 transition-colors"
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt={listing.title} className="h-32 w-full object-cover" />
                  ) : (
                    <div className="h-32 w-full bg-neutral-100" />
                  )}
                  <div className="p-2 bg-stone-50 border-t border-neutral-200">
                    <p className="text-xs font-medium truncate">{listing.title}</p>
                    <p className="text-xs text-neutral-500">
                      {(listing.priceCents / 100).toLocaleString(undefined, {
                        style: "currency",
                        currency: listing.currency,
                      })}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Section 3: Following ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Following</h2>
          <Link href="/account/feed" className="text-sm text-neutral-600 underline hover:text-neutral-900">
            View feed →
          </Link>
        </div>
        <div className="border border-neutral-200 p-5 flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold">{followCount}</p>
            <p className="text-xs text-neutral-500">maker{followCount !== 1 ? "s" : ""} followed</p>
          </div>
          <Link
            href="/account/following"
            className="border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50 transition-colors"
          >
            Manage →
          </Link>
        </div>
      </section>

      {/* ── Section 4: Commission Requests ── */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Commission Requests</h2>
        <div className="border border-neutral-200 p-4">
          <p className="text-sm text-neutral-500 mb-3">Custom pieces you&apos;ve requested from makers</p>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/account/commissions" className="text-sm underline hover:text-neutral-900">
              View my commission requests →
            </Link>
            <span className="text-sm text-neutral-400">or</span>
            <Link href="/commission" className="text-sm underline hover:text-neutral-900">
              Browse the Commission Room →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Section 5: Account Settings ── */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Account Settings</h2>
        <div className="border border-neutral-200 p-5 space-y-3">
          <div className="text-sm space-y-1">
            <p className="font-medium">{me.name ?? "—"}</p>
            <p className="text-neutral-500">{me.email}</p>
          </div>
          <p className="text-xs text-neutral-500">
            Update your name, email, and password through your account settings.
          </p>
        </div>
      </section>

      {/* ── Section 6: Workshop (sellers only) ── */}
      {sellerProfile && (
        <section>
          <h2 className="text-xl font-semibold mb-4">Your Workshop</h2>
          <div className="border border-neutral-200 p-5 space-y-4">
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-2xl font-bold">{sellerProfile._count.listings}</p>
                <p className="text-neutral-500 text-xs">Active listings</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{completedOrderCount}</p>
                <p className="text-neutral-500 text-xs">Completed orders</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Link
                href="/dashboard"
                className="border border-neutral-900 bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-800 transition-colors"
              >
                Go to Workshop →
              </Link>
              <Link
                href="/dashboard/blog"
                className="border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50 transition-colors"
              >
                My Blog Posts
              </Link>
              <Link
                href="/dashboard/blog/new"
                className="border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50 transition-colors"
              >
                Write a Post
              </Link>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

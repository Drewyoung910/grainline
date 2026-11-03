// src/app/dashboard/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Suspense } from "react";
import DismissibleBanner from "@/components/DismissibleBanner";
import LocalDate from "@/components/LocalDate";
import MediaImage from "@/components/MediaImage";
import WorkshopStats from "@/components/WorkshopStats";
import { AlertTriangle, ChevronRight, MessageCircle, Tag, Truck } from "@/components/icons";
import { WorkshopSkeleton } from "@/components/RouteSkeletons";
import { countActorUnreadMessages } from "@/lib/conversationMessageAuthority";
import { ensureSeller } from "@/lib/ensureSeller";
import { fulfillmentStatusLabel } from "@/lib/fulfillmentLabels";
import { DEFAULT_CURRENCY, formatCurrencyCents } from "@/lib/money";
import { orderTotalCents } from "@/lib/orderTotals";
import { publicSellerShopPath } from "@/lib/publicPaths";
import { sellerFacingOrderBuyerLabel } from "@/lib/sellerFacingUser";
import { sellerOwnerPrivateState } from "@/lib/sellerOwnerPrivateAccess";
import { sellerOwnerDashboardState } from "@/lib/sellerProfileOwnerAccess";
import { readWorkshopListingAttention, readWorkshopOrderQueue } from "@/lib/workshopData";
import { workshopAttentionRows, type WorkshopAttentionRow } from "@/lib/workshopQueue";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type DashboardPageProps = {
  searchParams?: Promise<{ setup?: string }>;
};

const ATTENTION_ICONS: Record<WorkshopAttentionRow["icon"], typeof Truck> = {
  truck: Truck,
  message: MessageCircle,
  alert: AlertTriangle,
  tag: Tag,
};

export default function DashboardPage(props: DashboardPageProps) {
  return (
    <Suspense fallback={<WorkshopSkeleton />}>
      <DashboardPageContent {...props} />
    </Suspense>
  );
}

async function DashboardPageContent({
  searchParams,
}: DashboardPageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard");
  const params = searchParams ? await searchParams : {};

  const { me, seller } = await ensureSeller();

  const sellerPrivate = await sellerOwnerPrivateState(seller.userId, seller.id);
  const onboardingComplete = sellerPrivate?.onboardingComplete ?? false;
  const forceSetupBanner = params.setup === "required";

  const [dashboardSeller, listingAttention, orderQueue, unreadMessages] = await Promise.all([
    sellerOwnerDashboardState(me.id),
    readWorkshopListingAttention(seller.id),
    readWorkshopOrderQueue(me.id),
    countActorUnreadMessages(me.id),
  ]);
  if (!dashboardSeller || dashboardSeller.sellerProfileId !== seller.id) {
    throw new Error("Seller dashboard authority returned an unexpected owner");
  }
  const vacationMode = dashboardSeller.vacationMode;
  const vacationReturnDate = dashboardSeller.vacationReturnDate;
  const chargesEnabled = dashboardSeller.chargesEnabled;

  const attentionRows = workshopAttentionRows({
    ordersToShip: orderQueue.awaiting.length,
    ordersToShipCapped: orderQueue.capped,
    orderNames: orderQueue.awaiting.map((order) => sellerFacingOrderBuyerLabel(order, "Buyer")),
    unreadMessages,
    underReview: listingAttention.underReview,
    underReviewTitle: listingAttention.underReviewTitle,
    rejected: listingAttention.rejected,
    lowStock: listingAttention.lowStock,
  });

  const shopStatus = vacationMode
    ? { label: "On vacation", className: "bg-amber-100 text-amber-900" }
    : !onboardingComplete || !chargesEnabled
      ? { label: "Not visible yet", className: "bg-amber-100 text-amber-900" }
      : { label: "Shop open", className: "bg-green-100 text-green-800" };

  return (
    <main className="mx-auto max-w-5xl space-y-7">
      {!onboardingComplete && (
        <DismissibleBanner
          className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 pr-10 text-sm text-amber-950"
          rejectedIds={forceSetupBanner ? [] : [`dashboard-onboarding:${seller.id}:${chargesEnabled ? "setup" : "stripe"}`]}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Finish setup to start selling</p>
              <p className="mt-1 text-amber-800">
                You can keep editing drafts and shop settings now. Complete setup before your listings can go live.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/dashboard/onboarding"
                className="inline-flex rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100"
              >
                Continue setup →
              </Link>
              {!chargesEnabled && (
                <Link
                  href="/dashboard/seller"
                  className="inline-flex rounded-md bg-amber-900 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800"
                >
                  Connect Stripe Payouts →
                </Link>
              )}
            </div>
          </div>
        </DismissibleBanner>
      )}


      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display page-title">Workshop</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-neutral-500">
            <span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-medium ${shopStatus.className}`}>{shopStatus.label}</span>
            <span className="min-w-0 truncate">{seller.displayName}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={publicSellerShopPath(seller.id, seller.displayName)} className="btn btn-secondary btn-sm">
            View shop
          </Link>
          <Link href="/dashboard/listings/new" className="btn btn-primary btn-sm">
            New listing
          </Link>
        </div>
      </header>

      {/* Stripe Connect banner */}
      {!chargesEnabled && onboardingComplete && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 flex items-center justify-between">
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
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-amber-900 text-sm">Vacation mode is active</p>
            <p className="text-amber-800 text-sm mt-0.5">
              Your listings are hidden and new orders are blocked.
              {vacationReturnDate && (
                <> Return date: {new Date(vacationReturnDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.</>
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

      <section aria-labelledby="workshop-attention-title" className="card-section p-5 sm:p-[22px]">
        <h2 id="workshop-attention-title" className="mb-3.5 font-display text-[26px] leading-tight">
          {attentionRows.length > 0 ? "Needs your attention" : "All caught up"}
        </h2>
        {attentionRows.length === 0 ? (
          <p className="text-sm text-neutral-600">No orders to ship, messages waiting or listings to fix right now.</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {attentionRows.map((row) => {
              const Icon = ATTENTION_ICONS[row.icon];
              return (
                <li key={row.key}>
                  <Link
                    href={row.href}
                    className="group flex items-center gap-3.5 rounded-[14px] bg-[#F7F5F0] px-3.5 py-3 transition-colors duration-150 hover:bg-[#EFEAE0]"
                  >
                    <span className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-white text-[#2C1F1A] ring-1 ring-stone-200/70">
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-neutral-900">{row.title}</span>
                      <span className="block truncate text-sm text-neutral-500">{row.detail}</span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-neutral-400 transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <WorkshopStats />

      <section aria-labelledby="workshop-recent-title" className="card-section p-5 sm:p-[22px]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 id="workshop-recent-title" className="font-display text-[26px] leading-tight">Recent orders</h2>
          <Link href="/dashboard/sales" className="group inline-flex items-center gap-1 text-sm font-medium text-neutral-800 underline-offset-4 hover:underline">
            All orders
            <ChevronRight size={14} className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </Link>
        </div>
        {orderQueue.recent.length === 0 ? (
          <p className="py-2 text-sm text-neutral-600">No orders yet. Your first sale is right around the corner.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {orderQueue.recent.map((order) => {
              const item = order.items[0];
              const extraItems = order.itemCount - 1;
              return (
                <li key={order.id}>
                  <Link href={`/dashboard/sales/${order.id}`} className="group flex items-center gap-3.5 py-3">
                    <MediaImage
                      src={item?.imageUrl}
                      alt=""
                      width={56}
                      height={56}
                      loading="lazy"
                      className="size-14 shrink-0 rounded-xl bg-[#EFEAE0] object-cover"
                      fallbackClassName="size-14 shrink-0 rounded-xl bg-[#EFEAE0]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-neutral-900 group-hover:underline">
                        {item?.title ?? `Order #${order.id.slice(-8)}`}
                        {extraItems > 0 ? ` and ${extraItems} more` : ""}
                      </span>
                      <span className="block truncate text-sm text-neutral-500">
                        {sellerFacingOrderBuyerLabel(order, "Buyer")} · <LocalDate date={order.createdAt} dateOnly />
                      </span>
                    </span>
                    <span className="hidden shrink-0 rounded-full bg-[#EFEAE0] px-2.5 py-0.5 text-[12.5px] font-medium text-neutral-700 sm:inline">
                      {fulfillmentStatusLabel(order.fulfillmentStatus ?? "PENDING")}
                    </span>
                    <span className="shrink-0 text-right font-medium tabular-nums text-neutral-900">
                      {formatCurrencyCents(
                        orderTotalCents(order, { itemsSubtotalCents: order.itemsSubtotalCents }),
                        order.currency ?? DEFAULT_CURRENCY,
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

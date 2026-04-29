// src/app/dashboard/orders/[id]/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import OpenCaseForm from "@/components/OpenCaseForm";
import CaseReplyBox from "@/components/CaseReplyBox";
import CaseEscalateButton from "@/components/CaseEscalateButton";
import CaseMarkResolvedButton from "@/components/CaseMarkResolvedButton";
import LocalDate from "@/components/LocalDate";
import { ArrowLeft, Truck, Gift } from "@/components/icons";
import OrderTimeline from "@/components/OrderTimeline";
import { caseStatusLabel } from "@/lib/caseLabels";
import { publicListingPath } from "@/lib/publicPaths";
import { latestRefundLedgerEvent } from "@/lib/refundRouteState";
import type { CaseStatus } from "@prisma/client";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function fmtMoney(cents: number, currency = "usd") {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-neutral-200 px-2 py-0.5 text-xs font-medium">
      {children}
    </span>
  );
}

function CaseStatusBadge({ status }: { status: CaseStatus }) {
  const color =
    status === "OPEN"
      ? "bg-amber-100 text-amber-800"
      : status === "IN_DISCUSSION"
      ? "bg-blue-100 text-blue-800"
      : status === "PENDING_CLOSE"
      ? "bg-teal-100 text-teal-800"
      : status === "UNDER_REVIEW"
      ? "bg-purple-100 text-purple-800"
      : status === "RESOLVED"
      ? "bg-green-100 text-green-800"
      : "bg-neutral-100 text-neutral-700"; // CLOSED

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {caseStatusLabel(status)}
    </span>
  );
}

function trackingUrl(carrier: string | null | undefined, number: string | null | undefined): string | null {
  if (!number) return null;
  const c = (carrier ?? "").toUpperCase();
  if (c.includes("UPS")) return `https://www.ups.com/track?tracknum=${number}`;
  if (c.includes("USPS")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`;
  if (c.includes("FEDEX") || c.includes("FED EX")) return `https://www.fedex.com/fedextrack/?trknbr=${number}`;
  if (c.includes("DHL")) return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${number}`;
  return null;
}

const REASON_LABELS: Record<string, string> = {
  NOT_RECEIVED: "Item not received",
  NOT_AS_DESCRIBED: "Not as described",
  DAMAGED: "Item arrived damaged",
  WRONG_ITEM: "Wrong item received",
  OTHER: "Other",
};

export default async function BuyerOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/orders");

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) redirect("/sign-in?redirect_url=/dashboard/orders");

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      buyer: { select: { id: true, name: true, email: true, imageUrl: true } },
      items: {
        include: {
          listing: {
            include: {
              photos: { orderBy: { sortOrder: "asc" }, take: 1 },
              seller: { select: { displayName: true, userId: true } },
            },
          },
        },
      },
      case: {
        include: {
          messages: {
            include: {
              author: { select: { name: true, email: true, role: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      paymentEvents: {
        where: { eventType: "REFUND" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { eventType: true, amountCents: true },
      },
    },
  });

  if (!order || order.buyerId !== me.id) notFound();

  const currency = order.currency ?? "usd";
  const itemsSubtotal =
    order.itemsSubtotalCents && order.itemsSubtotalCents > 0
      ? order.itemsSubtotalCents
      : order.items.reduce((s, it) => s + it.priceCents * it.quantity, 0);
  const shipping = order.shippingAmountCents ?? 0;
  const tax = order.taxAmountCents ?? 0;
  const total = itemsSubtotal + shipping + tax;

  const hasAddress =
    !!(order.shipToLine1 || order.shipToCity || order.shipToPostalCode || order.shipToCountry);
  const shippingDetailsPurged =
    !!order.buyerDataPurgedAt && !order.shipToLine1 && !order.shipToLine2;

  const status = order.fulfillmentStatus ?? "PENDING";
  const method = order.fulfillmentMethod ?? (hasAddress ? "SHIPPING" : "PICKUP");

  // Case eligibility
  const now = new Date();
  const deliveryPassed =
    order.estimatedDeliveryDate != null && order.estimatedDeliveryDate < now;
  const terminalStatuses = ["DELIVERED", "PICKED_UP"];
  const canOpenCase =
    deliveryPassed &&
    !order.case &&
    !terminalStatuses.includes(status);

  const activeCase = order.case;
  const externalRefund = latestRefundLedgerEvent(order.paymentEvents);
  const sellerRefundPending = order.sellerRefundId === "pending";
  const sellerRefundIssued = !!order.sellerRefundId && !sellerRefundPending;

  // Refund info — seller-initiated refund takes precedence; fall back to case staff refund
  const refundCents =
    (sellerRefundIssued ? order.sellerRefundAmountCents : null) ??
    activeCase?.refundAmountCents ??
    externalRefund?.amountCents ??
    null;
  const hasRefund = sellerRefundIssued || !!activeCase?.stripeRefundId || !!externalRefund;

  const caseOpen =
    activeCase &&
    (activeCase.status === "OPEN" ||
      activeCase.status === "IN_DISCUSSION" ||
      activeCase.status === "PENDING_CLOSE");

  const escalateAvailable =
    activeCase?.status === "IN_DISCUSSION" &&
    activeCase.escalateUnlocksAt != null &&
    activeCase.escalateUnlocksAt < now;

  // Conversation link for "contact seller" fallback
  const sellerUserId = order.items[0]?.listing.seller.userId ?? null;
  let messageHref = "/messages";
  if (sellerUserId) {
    const convo = await prisma.conversation.findFirst({
      where: {
        OR: [
          { userAId: me.id, userBId: sellerUserId },
          { userAId: sellerUserId, userBId: me.id },
        ],
      },
      select: { id: true },
    });
    messageHref = convo
      ? `/messages/${convo.id}`
      : `/messages/new?to=${sellerUserId}`;
  }

  const deliveryInFuture =
    order.estimatedDeliveryDate != null && order.estimatedDeliveryDate >= now;
  const isTerminal = terminalStatuses.includes(status);

  return (
    <main className="mx-auto max-w-4xl p-8 space-y-6">
      <Link href="/dashboard/orders" className="text-sm text-neutral-500 hover:text-neutral-700 mb-4 inline-flex items-center gap-1">
        <ArrowLeft size={14} /> Back to Orders
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">
          Order <span className="font-mono">#{order.id.slice(-8)}</span>
        </h1>
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <span>
            Placed <LocalDate date={order.createdAt} /> · {order.paidAt ? "Paid" : "Unpaid"}
          </span>
          <Badge>{method}</Badge>
          <Badge>{status.replaceAll("_", " ")}</Badge>
        </div>
      </header>

      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 font-medium">
        {status === "PENDING" && "Your maker is preparing your piece"}
        {status === "SHIPPED" && <span className="flex items-center gap-1.5"><Truck size={14} className="inline shrink-0" /> Your piece is on its way!</span>}
        {status === "DELIVERED" && "Delivered — enjoy your piece!"}
        {status === "READY_FOR_PICKUP" && "Ready for pickup!"}
        {status === "PICKED_UP" && "Picked up — enjoy!"}
      </div>

      <OrderTimeline
        placedAt={order.createdAt}
        shippedAt={order.shippedAt}
        deliveredAt={order.deliveredAt}
        pickupReadyAt={order.pickupReadyAt}
        pickedUpAt={order.pickedUpAt}
        fulfillmentMethod={method}
        fulfillmentStatus={status}
        trackingNumber={order.trackingNumber}
        trackingCarrier={order.trackingCarrier}
        refundAmountCents={hasRefund ? refundCents : null}
      />

      {hasRefund && (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
          A refund of{" "}
          <span className="font-semibold">
            {refundCents != null ? fmtMoney(refundCents, currency) : "an amount"}
          </span>{" "}
          has been issued to your original payment method. Please allow 5–10 business days.
        </div>
      )}

      {order.reviewNeeded && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Your order is being reviewed due to a shipping detail change. No action needed.
        </div>
      )}

      {(order.giftNote || order.giftWrapping) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm space-y-1">
          <div className="font-medium text-amber-800 flex items-center gap-1.5"><Gift size={14} className="inline" /> Gift order</div>
          {order.giftWrapping && <div className="text-amber-700">Gift wrapping requested</div>}
          {order.giftNote && <div className="text-amber-700">Note: &ldquo;{order.giftNote}&rdquo;</div>}
        </div>
      )}

      <section className="card-section">
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <div className="text-sm font-medium">Receipt</div>
          <div className="text-sm font-semibold">{fmtMoney(total, currency)}</div>
        </div>

        <ul className="divide-y divide-neutral-100">
          {order.items.map((it) => {
            const img = it.listing.photos[0]?.url;
            return (
              <li key={it.id} className="flex items-center gap-3 px-4 py-3">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className="h-16 w-16 rounded object-cover" />
                ) : (
                  <div className="h-16 w-16 rounded bg-neutral-100" />
                )}
                <div className="min-w-0 flex-1">
                  {it.listing.status === "ACTIVE" ? (
                    <Link
                      href={publicListingPath(it.listingId, it.listing.title)}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {it.listing.title}
                    </Link>
                  ) : (
                    <span className="block truncate text-sm font-medium text-neutral-500">
                      {it.listing.title}
                    </span>
                  )}
                  <div className="text-xs text-neutral-500">
                    Maker: {it.listing.seller.displayName}
                  </div>
                  {it.selectedVariants && Array.isArray(it.selectedVariants) && (it.selectedVariants as { groupName: string; optionLabel: string }[]).length > 0 && (
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {(it.selectedVariants as { groupName: string; optionLabel: string }[]).map((v) => `${v.groupName}: ${v.optionLabel}`).join(" · ")}
                    </p>
                  )}
                  <div className="mt-1 text-sm text-neutral-700">
                    {fmtMoney(it.priceCents, currency)} × {it.quantity}
                  </div>
                </div>
                <div className="text-sm font-medium">
                  {fmtMoney(it.priceCents * it.quantity, currency)}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="px-4 py-3 border-t border-neutral-100 space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <div className="text-neutral-600">Items subtotal</div>
            <div className="font-medium">{fmtMoney(itemsSubtotal, currency)}</div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-neutral-600">
              Shipping{order.shippingTitle ? ` · ${order.shippingTitle}` : ""}
              {order.shippingCarrier || order.shippingService ? (
                <>
                  {" "}
                  ·{" "}
                  <span className="text-neutral-700">
                    {[order.shippingCarrier, order.shippingService].filter(Boolean).join(" ")}
                  </span>
                </>
              ) : null}
            </div>
            <div className="font-medium">{fmtMoney(shipping, currency)}</div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-neutral-600">Tax</div>
            <div className="font-medium">{fmtMoney(tax, currency)}</div>
          </div>
          <hr className="my-1 border-neutral-100" />
          {hasRefund && refundCents != null && (
            <div className="flex items-center justify-between text-green-700">
              <div>Refund issued</div>
              <div className="font-medium">−{fmtMoney(refundCents, currency)}</div>
            </div>
          )}
          <div className="flex items-center justify-between text-base">
            <div className="text-neutral-800">
              {hasRefund ? "Net total" : "Total"}
            </div>
            <div className="font-semibold">
              {fmtMoney(
                hasRefund && refundCents != null ? Math.max(0, total - refundCents) : total,
                currency
              )}
            </div>
          </div>
        </div>
      </section>

      {method === "PICKUP" ? (
        <section className="card-section bg-neutral-50 px-4 py-3 text-sm">
          <div className="font-medium text-neutral-800">Local pickup</div>
          <div className="text-neutral-700">
            Your maker will coordinate pickup with you via Messages.
          </div>
          {order.pickupReadyAt && (
            <div className="mt-2 text-neutral-600">
              Ready for pickup since <LocalDate date={order.pickupReadyAt} />
            </div>
          )}
        </section>
      ) : shippingDetailsPurged && order.buyerDataPurgedAt ? (
        <section className="card-section bg-neutral-50 px-4 py-3 text-sm">
          <div className="font-medium text-neutral-800">Shipping details purged</div>
          <div className="text-neutral-700">
            Street address, buyer contact, and gift note details were removed under the retention policy.
          </div>
          <div className="mt-2 text-neutral-600">
            Purged on <LocalDate date={order.buyerDataPurgedAt} />
          </div>
        </section>
      ) : hasAddress ? (
        <section className="card-section bg-neutral-50 px-4 py-3 text-sm">
          <div className="font-medium text-neutral-800 mb-1">Ship to</div>
          <div className="text-neutral-700">
            {order.shipToLine1}
            {order.shipToLine2 ? (
              <>
                <br />
                {order.shipToLine2}
              </>
            ) : null}
            <br />
            {[order.shipToCity, order.shipToState, order.shipToPostalCode]
              .filter(Boolean)
              .join(", ")}
            <br />
            {order.shipToCountry}
          </div>
          {order.trackingNumber && (() => {
            const url = trackingUrl(order.trackingCarrier, order.trackingNumber);
            return (
              <div className="mt-2 text-neutral-700">
                <span className="font-medium">Tracking:</span>{" "}
                {order.trackingCarrier && <span>{order.trackingCarrier} · </span>}
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="underline hover:text-neutral-900">
                    {order.trackingNumber}
                  </a>
                ) : (
                  <span>{order.trackingNumber}</span>
                )}
              </div>
            );
          })()}
          {order.shippedAt && (
            <div className="mt-2 text-neutral-700">
              <span className="font-medium">Shipped on:</span>{" "}
              <LocalDate date={order.shippedAt} />
            </div>
          )}
          {status === "DELIVERED" ? (
            <div className="mt-2 font-medium text-green-700">Delivered</div>
          ) : order.estimatedDeliveryDate ? (
            status === "SHIPPED" ? (
              <div className="mt-2 text-blue-700">
                <span className="font-medium">In Transit</span> — Estimated delivery:{" "}
                <LocalDate date={order.estimatedDeliveryDate} />
              </div>
            ) : (
              <div className="mt-2 text-neutral-600">
                <span className="font-medium">Estimated delivery:</span>{" "}
                <LocalDate date={order.estimatedDeliveryDate} />
              </div>
            )
          ) : null}
        </section>
      ) : null}

      {/* ── Case section ── */}
      {activeCase ? (
        <section className="card-section space-y-0">
          <div className="flex items-center gap-3 border-b border-neutral-100 bg-white px-4 py-3">
            <div className="text-sm font-semibold">Case</div>
            <CaseStatusBadge status={activeCase.status} />
            <div className="text-xs text-neutral-500">
              {REASON_LABELS[activeCase.reason] ?? activeCase.reason}
            </div>
          </div>

          <ul className="divide-y divide-neutral-100 bg-white">
            {activeCase.messages.map((msg) => (
              <li key={msg.id} className="px-4 py-3 space-y-1">
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <span className="font-medium text-neutral-700">
                    {msg.author.name ?? (msg.author.role === "EMPLOYEE" || msg.author.role === "ADMIN" ? "Grainline Staff" : msg.author.email)}
                  </span>
                  <span>·</span>
                  <span><LocalDate date={msg.createdAt} /></span>
                </div>
                <p className="text-sm text-neutral-800 whitespace-pre-wrap">{msg.body}</p>
              </li>
            ))}
          </ul>

          {caseOpen && (
            <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-4">
              <CaseReplyBox caseId={activeCase.id} />
            </div>
          )}

          {(activeCase.status === "IN_DISCUSSION" || activeCase.status === "PENDING_CLOSE") && (
            <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-3 space-y-2">
              {activeCase.buyerMarkedResolved && !activeCase.sellerMarkedResolved ? (
                <p className="text-sm text-neutral-500">
                  Waiting for seller to confirm resolution.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <CaseMarkResolvedButton caseId={activeCase.id} />
                  {escalateAvailable && (
                    <CaseEscalateButton caseId={activeCase.id} />
                  )}
                </div>
              )}
            </div>
          )}

          {activeCase.status === "UNDER_REVIEW" && (
            <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
              This case is under review by Grainline staff.
            </div>
          )}

          {(activeCase.status === "RESOLVED" || activeCase.status === "CLOSED") && (
            <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
              This case is {caseStatusLabel(activeCase.status).toLowerCase()}.
            </div>
          )}
        </section>
      ) : canOpenCase ? (
        <section>
          <OpenCaseForm orderId={order.id} />
        </section>
      ) : !isTerminal ? (
        deliveryInFuture ? (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
            You can open a case if there&apos;s an issue with your order after the estimated
            delivery date of{" "}
            <span className="font-medium">
              <LocalDate date={order.estimatedDeliveryDate!} />
            </span>
            .
          </div>
        ) : (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
            If you have an issue with your order, please{" "}
            <Link href={messageHref} className="underline hover:text-neutral-900">
              contact the maker directly via messages
            </Link>
            .
          </div>
        )
      ) : null}

      <div className="flex gap-3">
        <Link
          href="/dashboard/orders"
          className="inline-flex items-center rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
        >
          Back to orders
        </Link>
        <Link
          href="/messages"
          className="inline-flex items-center rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
        >
          Message maker
        </Link>
      </div>
    </main>
  );
}

// src/app/dashboard/sales/[orderId]/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import LabelSection from "@/components/LabelSection";
import CaseReplyBox from "@/components/CaseReplyBox";
import CaseEscalateButton from "@/components/CaseEscalateButton";
import CaseMarkResolvedButton from "@/components/CaseMarkResolvedButton";
import SellerRefundPanel from "@/components/SellerRefundPanel";
import SellerNotesForm from "@/components/SellerNotesForm";
import { ArrowLeft, Gift } from "@/components/icons";
import LocalDate from "@/components/LocalDate";
import OrderTimeline from "@/components/OrderTimeline";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function fmtMoney(cents: number, currency = "usd") {
  return (cents / 100).toLocaleString(undefined, {
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

const REASON_LABELS: Record<string, string> = {
  NOT_RECEIVED: "Item not received",
  NOT_AS_DESCRIBED: "Not as described",
  DAMAGED: "Item arrived damaged",
  WRONG_ITEM: "Wrong item received",
  OTHER: "Other",
};

function trackingUrl(carrier: string | null | undefined, number: string | null | undefined): string | null {
  if (!number) return null;
  const c = (carrier ?? "").toUpperCase();
  if (c.includes("UPS")) return `https://www.ups.com/track?tracknum=${number}`;
  if (c.includes("USPS")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`;
  if (c.includes("FEDEX") || c.includes("FED EX")) return `https://www.fedex.com/fedextrack/?trknbr=${number}`;
  if (c.includes("DHL")) return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${number}`;
  return null;
}

function fmtTimeRemaining(deadline: Date, now: Date): string {
  const ms = deadline.getTime() - now.getTime();
  if (ms <= 0) return "Deadline has passed";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  return `${hours} hour${hours !== 1 ? "s" : ""}`;
}

export default async function SellerOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/sales");

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) redirect("/sign-in?redirect_url=/dashboard/sales");

  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: { id: true, displayName: true },
  });
  if (!seller) redirect("/dashboard/seller");

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      buyer: { select: { id: true, name: true, email: true, imageUrl: true } },
      items: {
        include: {
          listing: {
            include: {
              photos: { orderBy: { sortOrder: "asc" }, take: 1 },
              seller: { select: { id: true } },
            },
          },
        },
      },
      case: {
        include: {
          messages: {
            include: {
              author: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!order) notFound();

  const myItems = order.items.filter((it) => it.listing.seller.id === seller.id);
  if (myItems.length === 0) notFound();

  const currency = order.currency ?? "usd";
  const myItemsSubtotal = myItems.reduce((s, it) => s + it.priceCents * it.quantity, 0);
  const shipping = order.shippingAmountCents ?? 0;
  const tax = order.taxAmountCents ?? 0;
  const itemsSubtotal =
    order.itemsSubtotalCents && order.itemsSubtotalCents > 0
      ? order.itemsSubtotalCents
      : order.items.reduce((s, it) => s + it.priceCents * it.quantity, 0);
  const orderTotal = itemsSubtotal + shipping + tax;
  const hasAddress =
    !!(order.shipToLine1 || order.shipToCity || order.shipToPostalCode || order.shipToCountry);
  const isPickup =
    (order.shippingTitle?.toLowerCase().includes("pickup") ?? false) ||
    (shipping === 0 && !hasAddress);

  const status = order.fulfillmentStatus ?? "PENDING";
  const method = order.fulfillmentMethod ?? (isPickup ? "PICKUP" : "SHIPPING");

  const activeCase = order.case;
  const now = new Date();

  const refundCents =
    order.sellerRefundAmountCents ??
    activeCase?.refundAmountCents ??
    null;
  const hasRefund = !!(order.sellerRefundId || activeCase?.stripeRefundId);
  const buyerId = order.buyerId;
  const meId = me.id;

  // Per-message label helper (runs server-side)
  function msgLabel(authorId: string): string {
    if (authorId === buyerId) return "Buyer";
    if (authorId === meId) return "You (Seller)";
    return "Grainline Staff";
  }

  return (
    <main className="mx-auto max-w-4xl p-8 space-y-6">
      <Link href="/dashboard/sales" className="text-sm text-neutral-500 hover:text-neutral-700 mb-4 inline-flex items-center gap-1">
        <ArrowLeft size={14} /> Back to Sales
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
          {order.reviewNeeded && <Badge>Review needed</Badge>}
        </div>
        <div className="text-neutral-600 text-sm">
          Buyer: {order.buyer.name ?? order.buyer.email}
        </div>
      </header>

      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 font-medium">
        {status === "PENDING" && "New order — time to get crafting!"}
        {status === "SHIPPED" && "Shipped — nice work!"}
        {status === "DELIVERED" && "Delivered — another happy buyer!"}
        {status === "READY_FOR_PICKUP" && "Ready for pickup!"}
        {status === "PICKED_UP" && "Picked up — great work!"}
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

      {order.reviewNeeded && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Shipping address or rate changed during Checkout. Verify shipping before fulfillment.
        </div>
      )}

      {(order.giftNote || order.giftWrapping) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm space-y-1">
          <div className="font-medium text-amber-800 flex items-center gap-1.5"><Gift size={14} className="inline" /> Gift order</div>
          {order.giftWrapping && <div className="text-amber-700">Gift wrapping requested</div>}
          {order.giftNote && <div className="text-amber-700">Note: &ldquo;{order.giftNote}&rdquo;</div>}
        </div>
      )}

      {/* ── Case banners ── */}
      {activeCase?.status === "OPEN" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-0.5">
          <div className="font-semibold">A buyer has opened a case on this order</div>
          <div>
            Reason:{" "}
            <span className="font-medium">
              {REASON_LABELS[activeCase.reason] ?? activeCase.reason}
            </span>
          </div>
          <div>
            Respond by:{" "}
            <span className="font-medium">
              {activeCase.sellerRespondBy
                ? `${fmtTimeRemaining(activeCase.sellerRespondBy, now)} remaining`
                : "—"}
            </span>
          </div>
        </div>
      )}

      {activeCase?.status === "IN_DISCUSSION" && (
        <div className="rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900 space-y-0.5">
          <div className="font-semibold">Case in discussion</div>
          <div>
            Reason:{" "}
            <span className="font-medium">
              {REASON_LABELS[activeCase.reason] ?? activeCase.reason}
            </span>
          </div>
          {activeCase.escalateUnlocksAt && activeCase.escalateUnlocksAt > now && (
            <div className="text-xs">
              Escalation available in{" "}
              {fmtTimeRemaining(activeCase.escalateUnlocksAt, now)}
            </div>
          )}
        </div>
      )}

      {activeCase?.status === "PENDING_CLOSE" && (
        <div className="rounded-md border border-teal-300 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          <div className="font-semibold">Resolution pending confirmation</div>
          <div>Both parties must confirm to close the case.</div>
        </div>
      )}

      {activeCase?.status === "UNDER_REVIEW" && (
        <div className="rounded-md border border-purple-300 bg-purple-50 px-4 py-3 text-sm text-purple-900">
          <div className="font-semibold">Case under review</div>
          <div>
            This case is being reviewed by Grainline staff. We will contact you if we need more
            information.
          </div>
        </div>
      )}

      {activeCase?.status === "RESOLVED" && activeCase.resolution === "DISMISSED" && (
        <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
          <div className="font-semibold">Case resolved — dismissed</div>
          <div>The case was reviewed and dismissed. No refund was issued.</div>
        </div>
      )}

      {activeCase?.status === "RESOLVED" &&
        (activeCase.resolution === "REFUND_FULL" ||
          activeCase.resolution === "REFUND_PARTIAL") && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold">
              Case resolved —{" "}
              {activeCase.resolution === "REFUND_FULL" ? "full refund issued" : "partial refund issued"}
            </div>
            {activeCase.refundAmountCents != null && (
              <div>
                Refund amount:{" "}
                <span className="font-medium">
                  {fmtMoney(activeCase.refundAmountCents, currency)}
                </span>
              </div>
            )}
          </div>
        )}

      {/* ── Case thread ── */}
      {activeCase && (
        <section className="card-section">
          <div className="border-b border-neutral-100 bg-white px-4 py-3 text-sm font-semibold">Case thread</div>

          <ul className="divide-y divide-neutral-100 bg-white">
            {activeCase.messages.map((msg) => {
              const label = msgLabel(msg.author.id);
              const isMe = label === "You (Seller)";
              return (
                <li key={msg.id} className="px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <span
                      className={`font-medium ${
                        isMe
                          ? "text-neutral-900"
                          : label === "Grainline Staff"
                          ? "text-purple-700"
                          : "text-neutral-700"
                      }`}
                    >
                      {label}
                    </span>
                    <span>·</span>
                    <span><LocalDate date={msg.createdAt} /></span>
                  </div>
                  <p className="text-sm text-neutral-800 whitespace-pre-wrap">{msg.body}</p>
                </li>
              );
            })}
          </ul>

          {(activeCase.status === "OPEN" ||
            activeCase.status === "IN_DISCUSSION" ||
            activeCase.status === "PENDING_CLOSE") && (
            <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-4">
              <CaseReplyBox caseId={activeCase.id} />
            </div>
          )}

          {(activeCase.status === "IN_DISCUSSION" || activeCase.status === "PENDING_CLOSE") && (() => {
            const escalateAvailable =
              activeCase.status === "IN_DISCUSSION" &&
              activeCase.escalateUnlocksAt != null &&
              activeCase.escalateUnlocksAt < now;
            const waitingForBuyer =
              activeCase.sellerMarkedResolved && !activeCase.buyerMarkedResolved;
            return (
              <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-3 space-y-2">
                {waitingForBuyer ? (
                  <p className="text-sm text-neutral-500">
                    Waiting for buyer to confirm resolution.
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
            );
          })()}

          {activeCase.status === "UNDER_REVIEW" && (
            <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
              Awaiting staff review. You may not add messages at this time.
            </div>
          )}

          {(activeCase.status === "RESOLVED" || activeCase.status === "CLOSED") && (
            <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
              This case is {activeCase.status.toLowerCase()}.
            </div>
          )}
        </section>
      )}

      {/* Items */}
      <section className="card-section">
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <div className="text-sm font-medium">Items you sold in this order</div>
          <div className="text-sm font-semibold">{fmtMoney(myItemsSubtotal, currency)}</div>
        </div>

        <ul className="divide-y divide-neutral-100">
          {myItems.map((it) => {
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
                      href={`/listing/${it.listingId}`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {it.listing.title}
                    </Link>
                  ) : (
                    <span className="block truncate text-sm font-medium text-neutral-500">
                      {it.listing.title}
                    </span>
                  )}
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

        {/* Totals */}
        <div className="px-4 py-3 border-t border-neutral-100 text-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-neutral-600">Order items subtotal</span>
            <span className="font-medium">
              {fmtMoney(order.itemsSubtotalCents || myItemsSubtotal, currency)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-600">
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
            </span>
            <span className="font-medium">{fmtMoney(shipping, currency)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-600">Tax</span>
            <span className="font-medium">{fmtMoney(tax, currency)}</span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
            <span className="text-neutral-800">Order total</span>
            <span className="text-base font-semibold">{fmtMoney(orderTotal, currency)}</span>
          </div>
          {hasRefund && refundCents != null && (
            <>
              <div className="flex items-center justify-between text-amber-700">
                <span>Refund issued</span>
                <span className="font-medium">{fmtMoney(refundCents, currency)}</span>
              </div>
              <p className="text-xs text-neutral-500">
                This amount has been deducted from your Stripe balance.
              </p>
            </>
          )}
        </div>
      </section>

      {/* Fulfillment context */}
      {isPickup ? (
        <div className="card-section bg-neutral-50 px-4 py-3 text-sm">
          <div className="font-medium text-neutral-800">Local pickup selected</div>
          <div className="text-neutral-700">Coordinate pickup with the buyer via Messages.</div>
          {order.pickupReadyAt && (
            <div className="mt-2 text-neutral-600">
              Ready for pickup since <LocalDate date={order.pickupReadyAt} />
            </div>
          )}
        </div>
      ) : hasAddress ? (
        <div className="card-section bg-neutral-50 px-4 py-3 text-sm">
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
          {order.processingDeadline && (() => {
            const overdue =
              order.processingDeadline < now &&
              !["SHIPPED", "DELIVERED", "PICKED_UP"].includes(status);
            return (
              <div className={`mt-2 font-medium ${overdue ? "text-red-700" : "text-amber-700"}`}>
                {overdue ? "Overdue — should have shipped by " : "Ship by "}
                <LocalDate date={order.processingDeadline} />
              </div>
            );
          })()}
          {order.estimatedDeliveryDate && (
            <div className="mt-1 text-xs text-neutral-500">
              Estimated delivery to buyer:{" "}
              <LocalDate date={order.estimatedDeliveryDate} />
            </div>
          )}
        </div>
      ) : null}

      {/* Refund panel — shown when order is paid and not already fully refunded (by seller or admin) */}
      {order.paidAt && !order.sellerRefundId && !activeCase?.stripeRefundId && (
        <SellerRefundPanel
          orderId={order.id}
          currency={currency}
          orderTotalCents={orderTotal}
          alreadyRefundedId={null}
          alreadyRefundedCents={null}
        />
      )}
      {order.sellerRefundId && (
        <SellerRefundPanel
          orderId={order.id}
          currency={currency}
          orderTotalCents={orderTotal}
          alreadyRefundedId={order.sellerRefundId}
          alreadyRefundedCents={order.sellerRefundAmountCents ?? null}
        />
      )}

      {/* Actions */}
      {(status !== "DELIVERED" && status !== "PICKED_UP") && (
        <section className="card-section p-4 space-y-3">
          <div className="font-medium">Fulfillment actions</div>

          {method === "PICKUP" && status === "PENDING" && (
            <form method="post" action={`/api/orders/${order.id}/fulfillment`}>
              <input type="hidden" name="action" value="ready_for_pickup" />
              <button className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50">
                Mark ready for pickup
              </button>
            </form>
          )}

          {method === "PICKUP" && status === "READY_FOR_PICKUP" && (
            <form method="post" action={`/api/orders/${order.id}/fulfillment`}>
              <input type="hidden" name="action" value="picked_up" />
              <button className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50">
                Mark picked up
              </button>
            </form>
          )}

          {method === "SHIPPING" && status === "PENDING" && (
            <div className="space-y-4">
              <LabelSection
                orderId={order.id}
                labelStatus={order.labelStatus ?? null}
                labelUrl={order.labelUrl ?? null}
                labelCarrier={order.labelCarrier ?? null}
                labelTrackingNumber={order.labelTrackingNumber ?? null}
                labelPurchasedAt={order.labelPurchasedAt?.toISOString() ?? null}
                fulfillmentStatus={status}
                shippingAmountCents={shipping}
                currency={currency}
              />

              <div className="border-t border-neutral-100 pt-3 space-y-2">
                <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Already shipped? Enter tracking manually
                </div>
                <form
                  method="post"
                  action={`/api/orders/${order.id}/fulfillment`}
                  className="space-y-2"
                >
                  <input type="hidden" name="action" value="shipped" />
                  <div className="flex flex-wrap gap-2">
                    <select
                      name="trackingCarrier"
                      className="rounded border px-2 py-1 text-sm bg-white"
                      defaultValue=""
                    >
                      <option value="" disabled>Carrier</option>
                      <option value="UPS">UPS</option>
                      <option value="USPS">USPS</option>
                      <option value="FedEx">FedEx</option>
                      <option value="DHL">DHL</option>
                      <option value="Other">Other</option>
                    </select>
                    <input
                      name="trackingNumber"
                      placeholder="Tracking number"
                      className="rounded border px-2 py-1 text-sm"
                    />
                    <button className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50">
                      Mark shipped
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {method === "SHIPPING" && status === "SHIPPED" && (
            <form method="post" action={`/api/orders/${order.id}/fulfillment`} className="flex gap-2">
              <input type="hidden" name="action" value="delivered" />
              <button className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50">
                Mark delivered
              </button>
            </form>
          )}
        </section>
      )}

      {/* Seller notes */}
      <section className="card-section p-4 space-y-3">
        <div className="font-medium">Seller notes</div>
        <SellerNotesForm orderId={order.id} initialNotes={order.sellerNotes ?? ""} />
      </section>

      <div className="flex gap-3">
        <Link
          href="/dashboard/sales"
          className="inline-flex items-center rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
        >
          Back to sales
        </Link>
        <Link
          href={`/messages/new?to=${order.buyer.id}`}
          className="inline-flex items-center rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
        >
          Message buyer
        </Link>
      </div>
    </main>
  );
}

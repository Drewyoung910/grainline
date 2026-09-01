// src/app/dashboard/orders/[id]/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import OpenCaseForm from "@/components/OpenCaseForm";
import CaseReplyBox from "@/components/CaseReplyBox";
import { caseEvidenceAttachmentsEnabled } from "@/lib/caseEvidenceRelease";
import CaseInitialSummary from "@/components/CaseInitialSummary";
import CaseMessageHistoryNav from "@/components/CaseMessageHistoryNav";
import CaseEscalateButton from "@/components/CaseEscalateButton";
import CaseMarkResolvedButton from "@/components/CaseMarkResolvedButton";
import LocalDate from "@/components/LocalDate";
import { ArrowLeft, Truck, Gift } from "@/components/icons";
import OrderTimeline from "@/components/OrderTimeline";
import ConfirmButton from "@/components/ConfirmButton";
import { caseStatusLabel } from "@/lib/caseLabels";
import { fulfillmentStatusLabel } from "@/lib/fulfillmentLabels";
import { publicListingPath } from "@/lib/publicPaths";
import { buyerRefundOutcomes } from "@/lib/orderPaymentEventReadAuthority";
import { orderTotalCents } from "@/lib/orderTotals";
import {
  caseWindowClosedMessage,
  caseWindowClosesAt,
  isOrderCaseWindowClosed,
} from "@/lib/caseCreateState";
import { caseEscalationAvailable } from "@/lib/caseActionState";
import {
  unavailableCaseRecipientMessage,
} from "@/lib/caseMessagingState";
import { DEFAULT_CURRENCY, formatCurrencyCents } from "@/lib/money";
import type { CaseStatus } from "@prisma/client";
import type { Metadata } from "next";
import { findActorConversationPair } from "@/lib/conversationMessageAuthority";
import { findCaseMessageHistoryPage } from "@/lib/caseMessageHistory";
import { caseMessageAuthorLabel } from "@/lib/caseMessageAuthor";
import CaseMessageAttachments from "@/components/CaseMessageAttachments";
import { getVisibleCaseByOrderId } from "@/lib/caseReadAuthority";
import { getCaseMessagePreflight } from "@/lib/caseMessagePreflightAuthority";
import {
  historicalProcessingTimeDays,
} from "@/lib/orderItemSnapshot";
import { readBuyerOrderDetail } from "@/lib/orderParticipantDetailAuthority";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function fmtMoney(cents: number, currency = DEFAULT_CURRENCY) {
  return formatCurrencyCents(cents, currency);
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
  const trackingParam = encodeURIComponent(number);
  if (c.includes("UPS")) return `https://www.ups.com/track?tracknum=${trackingParam}`;
  if (c.includes("USPS")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingParam}`;
  if (c.includes("FEDEX") || c.includes("FED EX")) return `https://www.fedex.com/fedextrack/?trknbr=${trackingParam}`;
  if (c.includes("DHL")) return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${trackingParam}`;
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ caseBefore?: string | string[] }>;
}) {
  const [{ id }, { caseBefore }] = await Promise.all([params, searchParams]);

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/orders");

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) redirect("/sign-in?redirect_url=/dashboard/orders");

  const order = await readBuyerOrderDetail(me.id, id);

  if (!order) notFound();
  const historicalItems = order.items;
  const externalRefund = (
    await buyerRefundOutcomes(me.id, [order.id])
  ).get(order.id) ?? null;

  const currency = order.currency ?? DEFAULT_CURRENCY;
  const itemsSubtotal =
    order.itemsSubtotalCents && order.itemsSubtotalCents > 0
      ? order.itemsSubtotalCents
      : historicalItems.reduce((s, it) => s + it.priceCents * it.quantity, 0);
  const shipping = order.shippingAmountCents ?? 0;
  const tax = order.taxAmountCents ?? 0;
  const giftWrapping = order.giftWrappingPriceCents ?? 0;
  const total = orderTotalCents(order, { itemsSubtotalCents: itemsSubtotal });

  const hasAddress =
    !!(order.shipToLine1 || order.shipToCity || order.shipToPostalCode || order.shipToCountry);
  const shippingDetailsPurged =
    !!order.buyerDataPurgedAt && !order.shipToLine1 && !order.shipToLine2;

  const status = order.fulfillmentStatus ?? "PENDING";
  const method = order.fulfillmentMethod ?? (hasAddress ? "SHIPPING" : "PICKUP");
  const processingMins = historicalItems
    .map((item) => historicalProcessingTimeDays(item.snapshot).min)
    .filter((value): value is number => typeof value === "number");
  const processingMaxes = historicalItems
    .map((item) => historicalProcessingTimeDays(item.snapshot).max)
    .filter((value): value is number => typeof value === "number");
  const activeCase = await getVisibleCaseByOrderId({
    actorUserId: me.id,
    orderId: order.id,
  });
  const [caseMessageHistory, caseMessagePreflight] = activeCase
    ? await Promise.all([
        findCaseMessageHistoryPage(me.id, activeCase.id, caseBefore),
        getCaseMessagePreflight({
          actorUserId: me.id,
          caseId: activeCase.id,
        }),
      ])
    : [null, null];
  if (activeCase && !caseMessagePreflight) {
    throw new TypeError("Case message preflight denied a visible buyer case");
  }
  const sellerRefundIssued = order.sellerRefundState === "RECORDED";
  const hasCaseRefund =
    activeCase?.resolution === "REFUND_FULL"
    || activeCase?.resolution === "REFUND_PARTIAL";
  const hasRefund = sellerRefundIssued || hasCaseRefund || !!externalRefund;

  // Case eligibility
  const now = new Date();
  const terminalStatuses = ["DELIVERED", "PICKED_UP"];
  const isTerminal = terminalStatuses.includes(status);
  const caseWindowClosedAt = caseWindowClosesAt(order);
  const caseWindowClosed = isOrderCaseWindowClosed(order, now);
  const deliveryPassed =
    isTerminal || (order.estimatedDeliveryDate != null && order.estimatedDeliveryDate < now);
  const canOpenCase =
    deliveryPassed &&
    !caseWindowClosed &&
    !activeCase &&
    !hasRefund;

  // Refund info — seller-initiated refund takes precedence; fall back to case staff refund
  const refundCents =
    (sellerRefundIssued ? order.sellerRefundAmountCents : null) ??
    activeCase?.refundAmountCents ??
    externalRefund?.amountCents ??
    null;

  const caseOpen =
    activeCase &&
    (activeCase.status === "OPEN" ||
      activeCase.status === "IN_DISCUSSION" ||
      activeCase.status === "PENDING_CLOSE");
  const caseReplyUnavailableReason =
    caseMessagePreflight?.recipientUnavailableReason ?? null;
  const caseReplyUnavailableMessage = caseReplyUnavailableReason
    ? unavailableCaseRecipientMessage(caseReplyUnavailableReason)
    : null;

  const escalateAvailable = activeCase
    ? caseEscalationAvailable(
        activeCase.status,
        activeCase.escalateUnlocksAt,
        now,
        caseReplyUnavailableReason != null,
      )
    : false;

  // Conversation link for "contact seller" fallback
  const sellerUserId = order.sellerUserId;
  let messageHref: string | null = null;
  if (sellerUserId) {
    const convo = await findActorConversationPair(me.id, sellerUserId);
    messageHref = convo
      ? `/messages/${convo.id}`
      : `/messages/new?to=${sellerUserId}`;
  }

  const deliveryInFuture =
    order.estimatedDeliveryDate != null && order.estimatedDeliveryDate >= now;
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
          <Badge>{fulfillmentStatusLabel(status)}</Badge>
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
        estimatedDeliveryDate={order.estimatedDeliveryDate}
        processingTimeMinDays={processingMins.length > 0 ? Math.min(...processingMins) : null}
        processingTimeMaxDays={processingMaxes.length > 0 ? Math.max(...processingMaxes) : null}
        refundAmountCents={hasRefund ? refundCents : null}
        currency={currency}
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
          Your order is being reviewed by Grainline support. No action needed.
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
          {historicalItems.map((it) => {
            const img = it.snapshot.imageUrls[0];
            return (
              <li key={it.id} className="flex items-center gap-3 px-4 py-3">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className="h-16 w-16 rounded object-cover" />
                ) : (
                  <div className="h-16 w-16 rounded bg-neutral-100" />
                )}
                <div className="min-w-0 flex-1">
                  {it.listingLinkAvailable ? (
                    <Link
                      href={publicListingPath(it.listingId, it.snapshot.title)}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {it.snapshot.title}
                    </Link>
                  ) : (
                    <span className="block truncate text-sm font-medium text-neutral-500">
                      {it.snapshot.title}
                    </span>
                  )}
                  <div className="text-xs text-neutral-500">
                    Maker: {it.snapshot.sellerName}
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
          {giftWrapping > 0 && (
            <div className="flex items-center justify-between">
              <div className="text-neutral-600">Gift wrapping</div>
              <div className="font-medium">{fmtMoney(giftWrapping, currency)}</div>
            </div>
          )}
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
        <section className="card-section px-4 py-3 text-sm">
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
        <section className="card-section px-4 py-3 text-sm">
          <div className="font-medium text-neutral-800">Shipping details purged</div>
          <div className="text-neutral-700">
            Street address, buyer contact, and gift note details were removed under the retention policy.
          </div>
          <div className="mt-2 text-neutral-600">
            Purged on <LocalDate date={order.buyerDataPurgedAt} />
          </div>
        </section>
      ) : hasAddress ? (
        <section className="card-section px-4 py-3 text-sm">
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

      {method === "SHIPPING" && status === "SHIPPED" && !activeCase && !hasRefund && (
        <section className="card-section bg-white px-4 py-3 text-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium text-neutral-800">Received your order?</div>
              <div className="mt-0.5 text-neutral-600">
                Confirm delivery once the piece is in your hands.
              </div>
            </div>
            <form method="post" action={`/api/orders/${order.id}/confirm-delivery`}>
              <ConfirmButton
                confirm="Confirm that you received this order?"
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
              >
                Confirm delivery
              </ConfirmButton>
            </form>
          </div>
        </section>
      )}

      {/* ── Case section ── */}
      {activeCase && caseMessageHistory ? (
        <section className="card-section space-y-0">
          <div className="flex items-center gap-3 border-b border-neutral-100 bg-white px-4 py-3">
            <div className="text-sm font-semibold">Case</div>
            <CaseStatusBadge status={activeCase.status} />
            <div className="text-xs text-neutral-500">
              {REASON_LABELS[activeCase.reason] ?? activeCase.reason}
            </div>
          </div>

          {caseMessageHistory.messages.length === 0 ? (
            <div className="bg-white px-4 py-3">
              {caseMessageHistory.isHistoricalPage ? (
                <p className="text-sm text-neutral-500">No older messages found.</p>
              ) : (
                <CaseInitialSummary description={activeCase.description} />
              )}
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100 bg-white">
              {caseMessageHistory.messages.map((msg) => (
                <li key={msg.id} className="px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <span className="font-medium text-neutral-700">
                      {caseMessageAuthorLabel({
                        authorKind: msg.authorKind,
                        authorId: msg.authorId,
                        buyerId: activeCase.buyerId,
                        sellerId: activeCase.sellerId,
                        viewerId: me.id,
                      })}
                    </span>
                    <span>·</span>
                    <span><LocalDate date={msg.createdAt} /></span>
                  </div>
                  <p className="text-sm text-neutral-800 whitespace-pre-wrap">{msg.body}</p>
                  <CaseMessageAttachments
                    caseId={activeCase.id}
                    attachments={msg.attachments}
                  />
                </li>
              ))}
            </ul>
          )}
          <CaseMessageHistoryNav
            baseHref={`/dashboard/orders/${order.id}`}
            olderCursor={caseMessageHistory.olderCursor}
            isHistoricalPage={caseMessageHistory.isHistoricalPage}
          />

          {caseOpen && !caseMessageHistory.isHistoricalPage && (
            <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-4">
              {caseReplyUnavailableMessage ? (
                <p className="text-sm text-neutral-600">{caseReplyUnavailableMessage}</p>
              ) : (
                <CaseReplyBox
                  caseId={activeCase.id}
                  attachmentsEnabled={caseEvidenceAttachmentsEnabled()}
                />
              )}
            </div>
          )}

          {(activeCase.status === "IN_DISCUSSION" ||
            activeCase.status === "PENDING_CLOSE" ||
            (activeCase.status === "OPEN" && escalateAvailable)) &&
            !caseMessageHistory.isHistoricalPage && (
            <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-3 space-y-2">
              {activeCase.buyerMarkedResolved && !activeCase.sellerMarkedResolved ? (
                <p className="text-sm text-neutral-500">
                  Waiting for seller to confirm resolution.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {activeCase.status !== "OPEN" && <CaseMarkResolvedButton caseId={activeCase.id} />}
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
          <OpenCaseForm orderId={order.id} allowNotReceived={!isTerminal} />
        </section>
      ) : caseWindowClosed ? (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
          {caseWindowClosedMessage(caseWindowClosedAt)}
        </div>
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
        ) : messageHref ? (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
            If you have an issue with your order, please{" "}
            <Link href={messageHref} className="underline hover:text-neutral-900">
              contact the maker directly via messages
            </Link>
            .
          </div>
        ) : (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
            The maker&apos;s account is not available for messages. Please{" "}
            <Link href="/support" className="underline hover:text-neutral-900">
              contact Grainline support
            </Link>
            {" "}if you need help with this order.
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
        {messageHref ? (
          <Link
            href={messageHref}
            className="inline-flex items-center rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            Message maker
          </Link>
        ) : (
          <Link
            href="/support"
            className="inline-flex items-center rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            Contact support
          </Link>
        )}
      </div>
    </main>
  );
}

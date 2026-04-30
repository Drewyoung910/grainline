import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import AdminOrderActions from "./AdminOrderActions";
import { publicListingPath } from "@/lib/publicPaths";
import { latestRefundLedgerEvent } from "@/lib/refundRouteState";

function fmtMoney(cents: number | null | undefined, currency = "usd") {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-neutral-800">{value ?? "—"}</dd>
    </div>
  );
}

function PurgedBuyerData({ date }: { date: Date }) {
  return (
    <span className="text-neutral-500">
      Buyer street/contact details purged on {date.toLocaleDateString("en-US")}.
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-neutral-700">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      buyer: { select: { name: true, email: true, clerkId: true } },
      items: {
        include: {
          listing: {
            include: {
              photos: { orderBy: { sortOrder: "asc" }, take: 1 },
              seller: { select: { id: true, displayName: true } },
            },
          },
        },
      },
      case: {
        select: {
          id: true,
          status: true,
          resolution: true,
          stripeRefundId: true,
          refundAmountCents: true,
          resolvedAt: true,
        },
      },
      paymentEvents: {
        orderBy: { createdAt: "desc" },
        take: 25,
      },
    },
  });

  if (!order) notFound();

  const currency = order.currency ?? "usd";
  const total =
    (order.itemsSubtotalCents ?? 0) +
    (order.shippingAmountCents ?? 0) +
    (order.taxAmountCents ?? 0);

  // Fulfillment timeline entries
  const timeline: { label: string; at: Date | null }[] = [
    { label: "Order placed", at: order.createdAt },
    { label: "Paid", at: order.paidAt },
    { label: "Processing deadline", at: order.processingDeadline },
    { label: "Ready for pickup", at: order.pickupReadyAt },
    { label: "Picked up", at: order.pickedUpAt },
    { label: "Shipped", at: order.shippedAt },
    { label: "Estimated delivery", at: order.estimatedDeliveryDate },
    { label: "Delivered", at: order.deliveredAt },
  ].filter((e) => e.at !== null);

  // Unique sellers across items
  const sellers = Array.from(
    new Map(order.items.map((it) => [it.listing.seller.id, it.listing.seller])).values()
  );
  const externalRefund = latestRefundLedgerEvent(order.paymentEvents);

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">
              Order <span className="font-mono">#{order.id.slice(-8)}</span>
            </h1>
            {order.reviewNeeded && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                Needs Review
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {order.createdAt.toLocaleString("en-US")} ·{" "}
            <span className="font-medium">
              {(order.fulfillmentStatus ?? "PENDING").replaceAll("_", " ")}
            </span>
            {order.fulfillmentMethod && ` · ${order.fulfillmentMethod}`}
          </p>
        </div>
        <Link
          href="/admin/orders"
          className="text-sm text-neutral-500 hover:text-neutral-800 hover:underline"
        >
          ← All orders
        </Link>
      </div>

      {/* Review alert */}
      {order.reviewNeeded && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Action required:</strong> Shipping address or rate changed between quote and
          checkout. Review the quoted vs. actual shipping below before allowing fulfillment.
        </div>
      )}

      {/* Buyer + Seller */}
      <div className="grid grid-cols-2 gap-4">
        <Section title="Buyer">
          <dl className="space-y-3">
            <Field label="Name" value={order.buyer?.name ?? "Deleted user"} />
            <Field label="Email" value={order.buyer?.email ?? "—"} />
            <Field label="Stripe email" value={order.buyerEmail} />
            <Field
              label="Ship to"
              value={
                order.buyerDataPurgedAt && !order.shipToLine1 ? (
                  <PurgedBuyerData date={order.buyerDataPurgedAt} />
                ) : order.shipToLine1 ? (
                  <span>
                    {order.shipToLine1}
                    {order.shipToLine2 && <>, {order.shipToLine2}</>}
                    <br />
                    {[order.shipToCity, order.shipToState, order.shipToPostalCode]
                      .filter(Boolean)
                      .join(", ")}
                    {order.shipToCountry && `, ${order.shipToCountry}`}
                  </span>
                ) : null
              }
            />
          </dl>
        </Section>

        <Section title={sellers.length === 1 ? "Seller" : "Sellers"}>
          <dl className="space-y-3">
            {sellers.map((s) => (
              <div key={s.id}>
                <Field label="Display name" value={s.displayName} />
              </div>
            ))}
            {order.trackingCarrier || order.trackingNumber ? (
              <Field
                label="Tracking"
                value={[order.trackingCarrier, order.trackingNumber].filter(Boolean).join(" · ")}
              />
            ) : null}
          </dl>
        </Section>
      </div>

      {/* Items */}
      <Section title="Order Items">
        <ul className="divide-y divide-neutral-100 -my-1">
          {order.items.map((it) => {
            const img = it.listing.photos[0]?.url;
            return (
              <li key={it.id} className="flex items-center gap-3 py-3">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className="h-14 w-14 rounded border object-cover shrink-0" />
                ) : (
                  <div className="h-14 w-14 rounded border bg-neutral-100 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    href={publicListingPath(it.listingId, it.listing.title)}
                    className="block truncate text-sm font-medium text-neutral-800 hover:underline"
                  >
                    {it.listing.title}
                  </Link>
                  <div className="mt-0.5 text-xs text-neutral-500">
                    {it.listing.seller.displayName} · {fmtMoney(it.priceCents, currency)} ×{" "}
                    {it.quantity}
                  </div>
                </div>
                <div className="text-sm font-medium tabular-nums">
                  {fmtMoney(it.priceCents * it.quantity, currency)}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 space-y-1 border-t border-neutral-100 pt-3 text-sm">
          <div className="flex justify-between text-neutral-600">
            <span>Items subtotal</span>
            <span>{fmtMoney(order.itemsSubtotalCents, currency)}</span>
          </div>
          <div className="flex justify-between text-neutral-600">
            <span>
              Shipping
              {order.shippingTitle ? ` · ${order.shippingTitle}` : ""}
            </span>
            <span>{fmtMoney(order.shippingAmountCents, currency)}</span>
          </div>
          <div className="flex justify-between text-neutral-600">
            <span>Tax</span>
            <span>{fmtMoney(order.taxAmountCents, currency)}</span>
          </div>
          <div className="flex justify-between border-t border-neutral-100 pt-2 font-semibold">
            <span>Total</span>
            <span>{fmtMoney(total, currency)}</span>
          </div>
          {order.sellerRefundId === "pending" ? (
            <div className="flex justify-between text-amber-700 border-t border-neutral-100 pt-2">
              <span>Seller refund processing</span>
              <span className="font-medium">Pending</span>
            </div>
          ) : order.sellerRefundId ? (
            <div className="flex justify-between text-amber-700 border-t border-neutral-100 pt-2">
              <span>
                Seller refund
                <span className="ml-1 text-xs text-neutral-500 font-normal">
                  ({order.sellerRefundId})
                </span>
              </span>
              <span className="font-medium">
                {order.sellerRefundAmountCents != null ? fmtMoney(order.sellerRefundAmountCents, currency) : "Amount unavailable"}
              </span>
            </div>
          ) : null}
          {order.case?.stripeRefundId && (
            <div className="flex justify-between text-amber-700 border-t border-neutral-100 pt-2">
              <span>
                Case refund
                {order.case.resolution && (
                  <span className="ml-1 text-xs text-neutral-500 font-normal">
                    ({order.case.resolution.replaceAll("_", " ").toLowerCase()})
                  </span>
                )}
                <span className="ml-1 text-xs text-neutral-500 font-normal">
                  ({order.case.stripeRefundId})
                </span>
              </span>
              <span className="font-medium">{fmtMoney(order.case.refundAmountCents, currency)}</span>
            </div>
          )}
          {!order.sellerRefundId && !order.case?.stripeRefundId && externalRefund && (
            <div className="flex justify-between text-amber-700 border-t border-neutral-100 pt-2">
              <span>
                External Stripe refund
                <span className="ml-1 text-xs text-neutral-500 font-normal">
                  ({externalRefund.stripeObjectId ?? "refund event"})
                </span>
              </span>
              <span className="font-medium">{fmtMoney(externalRefund.amountCents, currency)}</span>
            </div>
          )}
        </div>
      </Section>

      {order.paymentEvents.length > 0 && (
        <Section title="Stripe Payment Events">
          <div className="space-y-3">
            {order.paymentEvents.map((event) => (
              <div
                key={event.id}
                className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-neutral-800">
                      {event.eventType.replaceAll("_", " ")}
                      {event.status ? ` · ${event.status}` : ""}
                    </div>
                    {event.description && (
                      <p className="mt-1 text-neutral-600">{event.description}</p>
                    )}
                    <div className="mt-1 text-xs text-neutral-500">
                      {event.stripeObjectType ?? "stripe"}:{" "}
                      <span className="font-mono">{event.stripeObjectId ?? "—"}</span>
                      {" · "}event: <span className="font-mono">{event.stripeEventId}</span>
                    </div>
                  </div>
                  <div className="text-right text-xs text-neutral-500">
                    <div className="text-sm font-medium text-neutral-800">
                      {fmtMoney(event.amountCents, event.currency)}
                    </div>
                    <div>{event.createdAt.toLocaleString("en-US")}</div>
                  </div>
                </div>
                {event.reason && (
                  <div className="mt-2 text-xs text-neutral-500">
                    Reason: <span className="font-mono">{event.reason}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Quoted vs Actual Shipping */}
      <Section title="Quoted vs. Actual Shipping">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-3">
              Quoted (before checkout)
            </h3>
            <dl className="space-y-3">
              <Field
                label="Amount"
                value={
                  <span
                    className={
                      order.quotedShippingAmountCents !== order.shippingAmountCents &&
                      order.quotedShippingAmountCents != null
                        ? "text-amber-700 font-medium"
                        : undefined
                    }
                  >
                    {fmtMoney(order.quotedShippingAmountCents, currency)}
                  </span>
                }
              />
              <Field
                label="Address"
                value={
                  order.quotedToPostalCode ? (
                    <span>
                      {[order.quotedToCity, order.quotedToState, order.quotedToPostalCode]
                        .filter(Boolean)
                        .join(", ")}
                      {order.quotedToCountry && `, ${order.quotedToCountry}`}
                    </span>
                  ) : null
                }
              />
              <Field
                label="Calculated rates used"
                value={
                  order.quotedUseCalculatedShipping === true
                    ? "Yes"
                    : order.quotedUseCalculatedShipping === false
                    ? "No"
                    : null
                }
              />
            </dl>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-3">
              Actual (from Stripe)
            </h3>
            <dl className="space-y-3">
              <Field
                label="Amount"
                value={
                  <span
                    className={
                      order.quotedShippingAmountCents !== order.shippingAmountCents &&
                      order.quotedShippingAmountCents != null
                        ? "text-amber-700 font-medium"
                        : undefined
                    }
                  >
                    {fmtMoney(order.shippingAmountCents, currency)}
                  </span>
                }
              />
              <Field
                label="Address"
                value={
                  order.buyerDataPurgedAt && !order.shipToLine1 ? (
                    <PurgedBuyerData date={order.buyerDataPurgedAt} />
                  ) : order.shipToPostalCode ? (
                    <span>
                      {order.shipToLine1 && <>{order.shipToLine1}<br /></>}
                      {[order.shipToCity, order.shipToState, order.shipToPostalCode]
                        .filter(Boolean)
                        .join(", ")}
                      {order.shipToCountry && `, ${order.shipToCountry}`}
                    </span>
                  ) : null
                }
              />
              <Field
                label="Service"
                value={[order.shippingCarrier, order.shippingService].filter(Boolean).join(" ")}
              />
            </dl>
          </div>
        </div>
      </Section>

      {/* Review note */}
      <Section title="Review Notes">
        {order.reviewNote ? (
          <pre className="whitespace-pre-wrap font-mono text-xs text-neutral-700 bg-neutral-50 rounded p-3 border border-neutral-100">
            {order.reviewNote}
          </pre>
        ) : (
          <p className="text-sm text-neutral-500">No notes yet.</p>
        )}
      </Section>

      {/* Fulfillment timeline */}
      {timeline.length > 0 && (
        <Section title="Fulfillment History">
          <ol className="space-y-2">
            {timeline.map(({ label, at }) => (
              <li key={label} className="flex items-baseline gap-3 text-sm">
                <span className="w-2 h-2 rounded-full bg-neutral-300 shrink-0 mt-1" />
                <span className="font-medium text-neutral-700 w-40 shrink-0">{label}</span>
                <span className="text-neutral-500 text-xs">{at!.toLocaleString("en-US")}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Admin actions */}
      <Section title="Admin Actions">
        <AdminOrderActions orderId={order.id} reviewNeeded={order.reviewNeeded} />
      </Section>
    </div>
  );
}

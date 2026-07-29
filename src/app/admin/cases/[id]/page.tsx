// src/app/admin/cases/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import CaseResolutionPanel from "@/components/CaseResolutionPanel";
import CaseReplyBox from "@/components/CaseReplyBox";
import { caseEvidenceAttachmentsEnabled } from "@/lib/caseEvidenceRelease";
import CaseInitialSummary from "@/components/CaseInitialSummary";
import CaseMessageHistoryNav from "@/components/CaseMessageHistoryNav";
import LocalDate from "@/components/LocalDate";
import { orderTotalCents } from "@/lib/orderTotals";
import { DEFAULT_CURRENCY, formatCurrencyCents } from "@/lib/money";
import { requireAdminPageAccess } from "@/lib/adminPageAccess";
import { refundMayRestoreStock } from "@/lib/refundRouteState";
import { caseStatusLabel } from "@/lib/caseLabels";
import type { CaseStatus } from "@prisma/client";
import { findCaseMessageHistoryPage } from "@/lib/caseMessageHistory";
import { caseMessageAuthorLabel } from "@/lib/caseMessageAuthor";
import CaseMessageAttachments from "@/components/CaseMessageAttachments";

function fmtMoney(cents: number | null | undefined, currency = DEFAULT_CURRENCY) {
  if (cents == null) return "—";
  return formatCurrencyCents(cents, currency);
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-neutral-800">{value ?? "—"}</dd>
    </div>
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
      : "bg-neutral-100 text-neutral-600"; // CLOSED
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}
    >
      {caseStatusLabel(status)}
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

function fmtDeadline(deadline: Date | null): { suffix: string; overdue: boolean } {
  if (!deadline) return { suffix: "", overdue: false };
  const now = new Date();
  const ms = deadline.getTime() - now.getTime();
  const overdue = ms <= 0;
  if (overdue) return { suffix: " (overdue)", overdue: true };
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const timeLeft = hours >= 48 ? `${Math.floor(hours / 24)}d remaining` : `${hours}h remaining`;
  return { suffix: ` · ${timeLeft}`, overdue: false };
}

export default async function AdminCaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ caseBefore?: string | string[] }>;
}) {
  const staff = await requireAdminPageAccess();
  const [{ id }, { caseBefore }] = await Promise.all([params, searchParams]);

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          id: true,
          currency: true,
          itemsSubtotalCents: true,
          shippingAmountCents: true,
          giftWrappingPriceCents: true,
          taxAmountCents: true,
          fulfillmentStatus: true,
          items: {
            select: {
              listingId: true,
              quantity: true,
              priceCents: true,
              listing: {
                select: {
                  title: true,
                  listingType: true,
                },
              },
            },
          },
        },
      },
      buyer: { select: { id: true, name: true, email: true } },
      seller: { select: { id: true, name: true, email: true } },
    },
  });

  if (!caseRecord) notFound();
  const caseMessageHistory = await findCaseMessageHistoryPage(
    staff.id,
    caseRecord.id,
    caseBefore,
  );

  const currency = caseRecord.order.currency ?? DEFAULT_CURRENCY;
  const isActive =
    caseRecord.status !== "RESOLVED" && caseRecord.status !== "CLOSED";
  const restorableRefundItems = Array.from(
    caseRecord.order.items.reduce((items, item) => {
      if (item.listing.listingType !== "IN_STOCK" || item.quantity <= 0) return items;
      const existing = items.get(item.listingId);
      items.set(item.listingId, {
        listingId: item.listingId,
        title: item.listing.title,
        quantity: (existing?.quantity ?? 0) + item.quantity,
      });
      return items;
    }, new Map<string, { listingId: string; title: string; quantity: number }>())
      .values(),
  );
  const canRestoreRefundStock = refundMayRestoreStock(caseRecord.order);

  const deadline = fmtDeadline(caseRecord.sellerRespondBy);

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">
              Case <span className="font-mono">#{caseRecord.id.slice(-8)}</span>
            </h1>
            <CaseStatusBadge status={caseRecord.status} />
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            Opened {caseRecord.createdAt.toLocaleString("en-US")} ·{" "}
            {REASON_LABELS[caseRecord.reason] ?? caseRecord.reason}
          </p>
        </div>
        <Link
          href="/admin/cases"
          className="text-sm text-neutral-500 hover:text-neutral-800 hover:underline"
        >
          ← All cases
        </Link>
      </div>

      {/* Parties + Order summary */}
      <div className="grid grid-cols-3 gap-4">
        <Section title="Buyer">
          <dl className="space-y-3">
            <Field label="Name" value={caseRecord.buyer?.name ?? "Deleted buyer"} />
            <Field label="Email" value={caseRecord.buyer?.email ?? "Unavailable"} />
          </dl>
        </Section>

        <Section title="Seller">
          <dl className="space-y-3">
            <Field label="Name" value={caseRecord.seller.name} />
            <Field label="Email" value={caseRecord.seller.email} />
          </dl>
        </Section>

        <Section title="Order">
          <dl className="space-y-3">
            <Field
              label="Order ID"
              value={
                <Link
                  href={`/admin/orders/${caseRecord.order.id}`}
                  className="font-mono text-blue-600 hover:underline"
                >
                  #{caseRecord.order.id.slice(-8)}
                </Link>
              }
            />
            <Field
              label="Items subtotal"
              value={fmtMoney(caseRecord.order.itemsSubtotalCents, currency)}
            />
            <Field
              label="Shipping"
              value={fmtMoney(caseRecord.order.shippingAmountCents, currency)}
            />
            {caseRecord.order.giftWrappingPriceCents ? (
              <Field
                label="Gift wrapping"
                value={fmtMoney(caseRecord.order.giftWrappingPriceCents, currency)}
              />
            ) : null}
            <Field
              label="Tax"
              value={fmtMoney(caseRecord.order.taxAmountCents, currency)}
            />
            <Field
              label="Total"
              value={fmtMoney(orderTotalCents(caseRecord.order), currency)}
            />
          </dl>
        </Section>
      </div>

      {/* Seller deadline */}
      <Section title="Seller Response Deadline">
        <p
          className={`text-sm ${
            deadline.overdue ? "font-medium text-red-700" : "text-neutral-700"
          }`}
        >
          {caseRecord.sellerRespondBy ? (
            <>
              <LocalDate date={caseRecord.sellerRespondBy} />
              {deadline.suffix}
            </>
          ) : (
            "—"
          )}
        </p>
      </Section>

      {/* Message thread */}
      <Section title="Case Thread">
        {caseMessageHistory.messages.length === 0 ? (
          caseMessageHistory.isHistoricalPage ? (
            <p className="text-sm text-neutral-500">No older messages found.</p>
          ) : (
            <CaseInitialSummary description={caseRecord.description} />
          )
        ) : (
          <ul className="divide-y divide-neutral-100 -my-1">
            {caseMessageHistory.messages.map((msg) => {
              const label = caseMessageAuthorLabel({
                authorKind: msg.authorKind,
                authorId: msg.authorId,
                buyerId: caseRecord.buyerId,
                sellerId: caseRecord.sellerId,
              });
              return (
                <li key={msg.id} className="py-3 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <span
                      className={`font-medium ${
                        label === "Grainline Staff"
                          ? "text-purple-700"
                          : label === "Buyer"
                          ? "text-neutral-800"
                          : "text-neutral-700"
                      }`}
                    >
                      {label}
                    </span>
                    <span>·</span>
                    <span>{msg.createdAt.toLocaleString("en-US")}</span>
                  </div>
                  <p className="text-sm text-neutral-800 whitespace-pre-wrap">{msg.body}</p>
                  <CaseMessageAttachments
                    caseId={caseRecord.id}
                    attachments={msg.attachments}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <CaseMessageHistoryNav
          baseHref={`/admin/cases/${caseRecord.id}`}
          olderCursor={caseMessageHistory.olderCursor}
          isHistoricalPage={caseMessageHistory.isHistoricalPage}
        />

        {isActive && !caseMessageHistory.isHistoricalPage && (
          <div className="mt-4 border-t border-neutral-100 pt-4">
            <p className="text-xs font-medium text-neutral-500 mb-2">
              Reply as Grainline Staff
            </p>
            <CaseReplyBox
              caseId={caseRecord.id}
              attachmentsEnabled={caseEvidenceAttachmentsEnabled()}
            />
          </div>
        )}
      </Section>

      {/* Resolution */}
      {isActive && !caseMessageHistory.isHistoricalPage && (
        <Section title="Resolve Case">
          <p className="text-sm text-neutral-600 mb-4">
            Resolving will close the case. Full and partial refunds are processed immediately via
            Stripe.
          </p>
          <CaseResolutionPanel
            caseId={caseRecord.id}
            currency={currency}
            restorableItems={restorableRefundItems}
            canRestoreStock={canRestoreRefundStock}
          />
        </Section>
      )}

      {/* Resolution summary (if resolved) */}
      {!isActive && caseRecord.resolution && (
        <Section title="Resolution">
          <dl className="space-y-3">
            <Field
              label="Outcome"
              value={
                caseRecord.resolution === "DISMISSED"
                  ? "Dismissed — no refund"
                  : caseRecord.resolution === "REFUND_FULL"
                  ? "Full refund issued"
                  : "Partial refund issued"
              }
            />
            {caseRecord.refundAmountCents != null && (
              <Field
                label="Refund amount"
                value={fmtMoney(caseRecord.refundAmountCents, currency)}
              />
            )}
            {caseRecord.stripeRefundId && (
              <Field label="Stripe refund ID" value={caseRecord.stripeRefundId} />
            )}
            {caseRecord.resolvedAt && (
              <Field label="Resolved at" value={caseRecord.resolvedAt.toLocaleString("en-US")} />
            )}
          </dl>
        </Section>
      )}
    </div>
  );
}

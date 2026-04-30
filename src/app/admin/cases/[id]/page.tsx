// src/app/admin/cases/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import CaseResolutionPanel from "@/components/CaseResolutionPanel";
import CaseReplyBox from "@/components/CaseReplyBox";

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

function CaseStatusBadge({ status }: { status: string }) {
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
      {status.replaceAll("_", " ")}
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

function fmtDeadline(deadline: Date | null): { text: string; overdue: boolean } {
  if (!deadline) return { text: "—", overdue: false };
  const now = new Date();
  const ms = deadline.getTime() - now.getTime();
  const overdue = ms <= 0;
  if (overdue) return { text: `${deadline.toLocaleString("en-US")} (overdue)`, overdue: true };
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const timeLeft = hours >= 48 ? `${Math.floor(hours / 24)}d remaining` : `${hours}h remaining`;
  return { text: `${deadline.toLocaleString("en-US")} · ${timeLeft}`, overdue: false };
}

export default async function AdminCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          id: true,
          currency: true,
          itemsSubtotalCents: true,
          shippingAmountCents: true,
          taxAmountCents: true,
        },
      },
      buyer: { select: { id: true, name: true, email: true } },
      seller: { select: { id: true, name: true, email: true } },
      messages: {
        include: {
          author: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!caseRecord) notFound();

  const currency = caseRecord.order.currency ?? "usd";
  const isActive =
    caseRecord.status !== "RESOLVED" && caseRecord.status !== "CLOSED";

  const deadline = fmtDeadline(caseRecord.sellerRespondBy);

  function msgLabel(authorId: string, role: string): string {
    if (role === "EMPLOYEE" || role === "ADMIN") return "Grainline Staff";
    if (authorId === caseRecord!.buyerId) return "Buyer";
    return "Seller";
  }

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
            <Field
              label="Tax"
              value={fmtMoney(caseRecord.order.taxAmountCents, currency)}
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
          {deadline.text}
        </p>
      </Section>

      {/* Message thread */}
      <Section title="Case Thread">
        {caseRecord.messages.length === 0 ? (
          <p className="text-sm text-neutral-500">No messages yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 -my-1">
            {caseRecord.messages.map((msg) => {
              const label = msgLabel(msg.author.id, msg.author.role);
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
                    <span>{msg.author.name ?? msg.author.email}</span>
                    <span>·</span>
                    <span>{msg.createdAt.toLocaleString("en-US")}</span>
                  </div>
                  <p className="text-sm text-neutral-800 whitespace-pre-wrap">{msg.body}</p>
                </li>
              );
            })}
          </ul>
        )}

        {isActive && (
          <div className="mt-4 border-t border-neutral-100 pt-4">
            <p className="text-xs font-medium text-neutral-500 mb-2">
              Reply as Grainline Staff
            </p>
            <CaseReplyBox caseId={caseRecord.id} />
          </div>
        )}
      </Section>

      {/* Resolution */}
      {isActive && (
        <Section title="Resolve Case">
          <p className="text-sm text-neutral-600 mb-4">
            Resolving will close the case. Full and partial refunds are processed immediately via
            Stripe.
          </p>
          <CaseResolutionPanel caseId={caseRecord.id} currency={currency} />
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

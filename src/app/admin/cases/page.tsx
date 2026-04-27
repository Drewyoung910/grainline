// src/app/admin/cases/page.tsx
import { prisma } from "@/lib/db";
import Link from "next/link";
import type { CaseStatus } from "@prisma/client";

const PAGE_SIZE = 25;

const VALID_STATUSES: CaseStatus[] = [
  "OPEN",
  "IN_DISCUSSION",
  "PENDING_CLOSE",
  "UNDER_REVIEW",
  "RESOLVED",
  "CLOSED",
];

const REASON_LABELS: Record<string, string> = {
  NOT_RECEIVED: "Item not received",
  NOT_AS_DESCRIBED: "Not as described",
  DAMAGED: "Item arrived damaged",
  WRONG_ITEM: "Wrong item received",
  OTHER: "Other",
};

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
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export default async function AdminCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { page: pageParam, status: statusParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const statusFilter =
    statusParam && VALID_STATUSES.includes(statusParam as CaseStatus)
      ? (statusParam as CaseStatus)
      : undefined;

  const where = statusFilter ? { status: statusFilter } : undefined;

  const [cases, total] = await Promise.all([
    prisma.case.findMany({
      where,
      // Sort: active cases (resolvedAt = null) first, then by createdAt desc
      orderBy: [
        { resolvedAt: { sort: "asc", nulls: "first" } },
        { createdAt: "desc" },
      ],
      skip,
      take: PAGE_SIZE,
      include: {
        order: { select: { id: true } },
        buyer: { select: { name: true, email: true } },
        seller: { select: { name: true, email: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.case.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  function pagerHref(p: number) {
    const params = new URLSearchParams();
    params.set("page", String(p));
    if (statusFilter) params.set("status", statusFilter);
    return `?${params.toString()}`;
  }

  function filterHref(s?: string) {
    const params = new URLSearchParams();
    if (s) params.set("status", s);
    return `?${params.toString()}`;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">Cases</h1>
      </div>
      <p className="text-sm text-neutral-500 mb-4">{total} case{total !== 1 ? "s" : ""}</p>

      {/* Status filter tabs */}
      <div className="flex gap-1.5 mb-6 flex-wrap">
        <Link
          href={filterHref()}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            !statusFilter
              ? "bg-neutral-900 text-white border-neutral-900"
              : "bg-white text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          All
        </Link>
        {VALID_STATUSES.map((s) => (
          <Link
            key={s}
            href={filterHref(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              statusFilter === s
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {s.replaceAll("_", " ")}
          </Link>
        ))}
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-16 text-center text-neutral-400">
          No cases{statusFilter ? ` with status ${statusFilter}` : ""}.
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-neutral-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-100 bg-neutral-50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium text-neutral-500">Case</th>
                  <th className="px-4 py-3 font-medium text-neutral-500">Order</th>
                  <th className="px-4 py-3 font-medium text-neutral-500">Buyer</th>
                  <th className="px-4 py-3 font-medium text-neutral-500">Seller</th>
                  <th className="px-4 py-3 font-medium text-neutral-500">Reason</th>
                  <th className="px-4 py-3 font-medium text-neutral-500">Status</th>
                  <th className="px-4 py-3 font-medium text-neutral-500 text-right">Msgs</th>
                  <th className="px-4 py-3 font-medium text-neutral-500">Opened</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {cases.map((c) => (
                  <tr key={c.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                      #{c.id.slice(-8)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                      #{c.order.id.slice(-8)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-800">
                        {c.buyer.name ?? c.buyer.email}
                      </div>
                      {c.buyer.name && (
                        <div className="text-xs text-neutral-400">{c.buyer.email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {c.seller.name ?? c.seller.email}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 text-xs">
                      {REASON_LABELS[c.reason] ?? c.reason}
                    </td>
                    <td className="px-4 py-3">
                      <CaseStatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-500 text-xs">
                      {c._count.messages}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500 whitespace-nowrap">
                      {c.createdAt.toLocaleDateString("en-US")}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/cases/${c.id}`}
                        className="text-blue-600 hover:underline text-xs whitespace-nowrap"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
            <span>
              {total} case{total !== 1 ? "s" : ""} · Page {safePage} of {totalPages}
            </span>
            <div className="flex gap-2">
              {safePage > 1 ? (
                <Link
                  href={pagerHref(safePage - 1)}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
                >
                  Previous
                </Link>
              ) : (
                <span className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-300 cursor-not-allowed">
                  Previous
                </span>
              )}
              {safePage < totalPages ? (
                <Link
                  href={pagerHref(safePage + 1)}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
                >
                  Next
                </Link>
              ) : (
                <span className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-300 cursor-not-allowed">
                  Next
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

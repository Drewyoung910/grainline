// src/app/account/commissions/page.tsx
import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { truncateTextWithEllipsis } from "@/lib/sanitize";
import type { Metadata } from "next";
import { CATEGORY_LABELS } from "@/lib/categories";
import { resolvedInterestedCount } from "@/lib/commissionInterestCount";
import { formatCommissionBudgetRange } from "@/lib/commissionBudget";
import type { CommissionStatus } from "@prisma/client";

export const metadata: Metadata = { title: "My Commission Requests", robots: { index: false, follow: false } };

const STATUS_LABELS: Record<CommissionStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  FULFILLED: "Fulfilled",
  CLOSED: "Closed",
  EXPIRED: "Expired",
};

const STATUS_COLORS: Record<CommissionStatus, string> = {
  OPEN: "bg-green-50 text-green-700 border-green-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  FULFILLED: "bg-amber-50 text-amber-700 border-amber-200",
  CLOSED: "bg-neutral-50 text-neutral-600 border-neutral-200",
  EXPIRED: "bg-neutral-50 text-neutral-500 border-neutral-200",
};

export default async function MyCommissionsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account/commissions");

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) redirect("/sign-in");

  const requestRows = await prisma.commissionRequest.findMany({
    where: { buyerId: me.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      budgetMinCents: true,
      budgetMaxCents: true,
      status: true,
      interestedCount: true,
      _count: { select: { interests: true } },
      createdAt: true,
      interests: {
        take: 3,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          sellerProfile: {
            select: {
              id: true,
              displayName: true,
              avatarImageUrl: true,
              user: { select: { imageUrl: true } },
            },
          },
        },
      },
    },
  });
  const requests = requestRows.map(({ _count, ...request }) => ({
    ...request,
    interestedCount: resolvedInterestedCount({
      interestedCount: request.interestedCount,
      _count,
    }),
  }));

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6">
      <Link href="/account" className="text-sm text-neutral-500 hover:text-neutral-700 mb-4 inline-flex items-center gap-1">
        ← My Account
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-neutral-900">My Commission Requests</h1>
          <p className="mt-1 text-sm text-neutral-500">Track custom project requests and interested makers.</p>
        </div>
        <Link
          href="/commission/new"
          className="inline-flex min-h-10 w-fit items-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
        >
          Post a Request
        </Link>
      </div>

      {requests.length === 0 ? (
        <div className="card-section p-12 text-center">
          <p className="text-neutral-500 mb-4">You haven&apos;t posted any commission requests yet.</p>
          <Link
            href="/commission/new"
            className="inline-flex min-h-10 items-center rounded-md border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
          >
            Post your first request
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <article key={r.id} className="card-section p-4 transition-shadow hover:shadow-md">
              <div className="mb-2 flex items-start justify-between gap-3">
                <Link href={`/commission/${r.id}`} className="min-w-0 flex-1 text-base font-semibold text-neutral-900 hover:underline">
                  {r.title}
                </Link>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status]}`}>
                  {STATUS_LABELS[r.status]}
                </span>
              </div>

              <p className="text-sm text-neutral-500 line-clamp-2 mb-3">
                {truncateTextWithEllipsis(r.description, 150)}
              </p>

              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                {r.category && <span>{CATEGORY_LABELS[r.category]}</span>}
                {formatCommissionBudgetRange(r.budgetMinCents, r.budgetMaxCents) && (
                  <span>{formatCommissionBudgetRange(r.budgetMinCents, r.budgetMaxCents)}</span>
                )}
                <span>
                  {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <Link
                  href={`/commission/${r.id}`}
                  className="ml-auto inline-flex min-h-[32px] items-center rounded-md border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                >
                  View details
                </Link>
              </div>

              {/* Interested seller avatars */}
              {r.interests.length > 0 && (
                <div className="mt-3 flex items-center gap-2 border-t border-neutral-100 pt-3">
                  <div className="flex -space-x-1.5">
                    {r.interests.map((interest) => {
                      const sp = interest.sellerProfile;
                      const avatar = sp?.avatarImageUrl ?? sp?.user?.imageUrl;
                      return avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={interest.id}
                          src={avatar}
                          alt={sp?.displayName ?? ""}
                          className="h-6 w-6 rounded-full object-cover ring-1 ring-neutral-200 shadow-sm"
                        />
                      ) : (
                        <div key={interest.id} className="h-6 w-6 rounded-full bg-neutral-200 ring-1 ring-neutral-200 shadow-sm" />
                      );
                    })}
                  </div>
                  <span className="text-xs text-neutral-500">
                    {r.interestedCount} maker{r.interestedCount !== 1 ? "s" : ""} interested
                  </span>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

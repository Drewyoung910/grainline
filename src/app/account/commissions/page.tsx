// src/app/account/commissions/page.tsx
import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { CATEGORY_LABELS } from "@/lib/categories";
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

  const requests = await prisma.commissionRequest.findMany({
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

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      <Link href="/account" className="text-sm text-neutral-500 hover:text-neutral-700 mb-4 inline-flex items-center gap-1">
        ← My Account
      </Link>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold font-display text-neutral-900">My Commission Requests</h1>
        <Link
          href="/commission/new"
          className="text-sm bg-neutral-900 text-white px-4 py-2 hover:bg-neutral-700 transition-colors"
        >
          Post a Request
        </Link>
      </div>

      {requests.length === 0 ? (
        <div className="card-section p-12 text-center">
          <p className="text-neutral-500 mb-4">You haven&apos;t posted any commission requests yet.</p>
          <Link
            href="/commission/new"
            className="inline-block border border-neutral-900 px-4 py-2 text-sm hover:bg-neutral-50"
          >
            Post your first request →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <div key={r.id} className="card-section p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <Link href={`/commission/${r.id}`} className="font-semibold text-neutral-900 hover:underline flex-1">
                  {r.title}
                </Link>
                <span className={`text-xs border rounded-full px-2 py-0.5 shrink-0 ${STATUS_COLORS[r.status]}`}>
                  {STATUS_LABELS[r.status]}
                </span>
              </div>

              <p className="text-sm text-neutral-500 line-clamp-2 mb-3">
                {r.description.slice(0, 150)}{r.description.length > 150 ? "…" : ""}
              </p>

              <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                {r.category && <span>{CATEGORY_LABELS[r.category]}</span>}
                {(r.budgetMinCents || r.budgetMaxCents) && (
                  <span>
                    {r.budgetMinCents && r.budgetMaxCents
                      ? `$${(r.budgetMinCents / 100).toFixed(0)}–$${(r.budgetMaxCents / 100).toFixed(0)}`
                      : r.budgetMinCents
                      ? `From $${(r.budgetMinCents / 100).toFixed(0)}`
                      : `Up to $${(r.budgetMaxCents! / 100).toFixed(0)}`}
                  </span>
                )}
                <span>
                  {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <Link href={`/commission/${r.id}`} className="ml-auto text-neutral-600 hover:underline">
                  View →
                </Link>
              </div>

              {/* Interested seller avatars */}
              {r.interests.length > 0 && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-neutral-100">
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
                          className="w-6 h-6 rounded-full object-cover border-2 border-white"
                        />
                      ) : (
                        <div key={interest.id} className="w-6 h-6 rounded-full bg-neutral-200 border-2 border-white" />
                      );
                    })}
                  </div>
                  <span className="text-xs text-neutral-500">
                    {r.interestedCount} maker{r.interestedCount !== 1 ? "s" : ""} interested
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

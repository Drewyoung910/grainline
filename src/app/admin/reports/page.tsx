import { requireAdminPageAccess } from "@/lib/adminPageAccess";
import AdminPinGate from "@/components/AdminPinGate";
import { prisma } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import { ResolveReportButton } from "@/components/admin/ResolveReportButton";
import { publicListingPath, publicSellerPath } from "@/lib/publicPaths";
import { userStaffAdminLabels, userStaffReportLabels } from "@/lib/userStaffAccess";
import { getOrderStaffReadClient } from "@/lib/orderStaffReadDb";
import { sellerProfileStaffReportTargets } from "@/lib/sellerProfileStaffAccess";
import {
  userReportStaffOpenCount,
  userReportStaffOpenPage,
  userReportStaffTopReporters,
  type UserReportStaffCursor,
} from "@/lib/userReportAccess";

export const metadata: Metadata = { title: "Reports — Admin" };
const REPORT_PAGE_SIZE = 25;
const REPORT_CURSOR_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/u;

type ReportUserLabel = {
  name: string | null;
  email: string | null;
  deletedAt: Date | null;
};

function reportUserLabel(user: ReportUserLabel | null | undefined) {
  if (!user) return "Unknown";
  if (user.deletedAt) return "Deleted user";
  return user.name ?? user.email ?? "Unknown";
}

function reportUserSearchValue(user: ReportUserLabel | null | undefined) {
  if (!user || user.deletedAt) return "";
  return user.email ?? user.name ?? "";
}

function isSellerProfileReportTarget(targetType: string | null) {
  return targetType === "SELLER_PROFILE" || targetType === "SELLER";
}

function parseReportCursor(searchParams: Record<string, string | string[] | undefined>) {
  const createdAtValue = typeof searchParams.afterCreatedAt === "string"
    ? searchParams.afterCreatedAt
    : null;
  const id = typeof searchParams.afterId === "string" ? searchParams.afterId : null;
  if (!createdAtValue || !id || !REPORT_CURSOR_ID_PATTERN.test(id)) return null;
  const createdAt = new Date(createdAtValue);
  if (!Number.isFinite(createdAt.getTime())) return null;
  return { createdAt, id } satisfies UserReportStaffCursor;
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireAdminPageAccess();
  if (!staff) return <AdminPinGate />;

  const cursor = parseReportCursor(await searchParams);
  const staffClient = getOrderStaffReadClient();
  const [openCount, reports, topReporters] = await Promise.all([
    userReportStaffOpenCount(staffClient, staff.id),
    userReportStaffOpenPage(staffClient, {
      actorUserId: staff.id,
      cursor,
      limit: REPORT_PAGE_SIZE,
    }),
    userReportStaffTopReporters(staffClient, {
      actorUserId: staff.id,
      since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      limit: 5,
    }),
  ]);
  const reportUsers = await userStaffAdminLabels(staffClient, {
    actorId: staff.id,
    userIds: reports.flatMap((report) => [report.reporterId, report.reportedId]),
  });
  const reportUserById = new Map(reportUsers.map((user) => [user.id, user]));

  // Batch-resolve context URLs for REVIEW and BLOG_COMMENT reports
  const reviewTargetIds = reports
    .filter((r) => r.targetType === "REVIEW" && r.targetId)
    .map((r) => r.targetId!);
  const blogCommentTargetIds = reports
    .filter((r) => r.targetType === "BLOG_COMMENT" && r.targetId)
    .map((r) => r.targetId!);
  const listingTargetIds = reports
    .filter((r) => r.targetType === "LISTING" && r.targetId)
    .map((r) => r.targetId!);
  const sellerTargetIds = reports
    .filter((r) => isSellerProfileReportTarget(r.targetType) && r.targetId)
    .map((r) => r.targetId!);

  const reviewListingMap = new Map<string, { id: string; title: string }>();
  const blogCommentSlugMap = new Map<string, string>();
  const listingPathMap = new Map<string, string>();
  const sellerPathMap = new Map<string, string>();

  if (reviewTargetIds.length > 0) {
    const reviews = await prisma.review.findMany({
      where: { id: { in: reviewTargetIds } },
      select: { id: true, listing: { select: { id: true, title: true } } },
    });
    for (const rv of reviews) {
      reviewListingMap.set(rv.id, rv.listing);
    }
  }

  if (listingTargetIds.length > 0) {
    const listings = await prisma.listing.findMany({
      where: { id: { in: listingTargetIds } },
      select: { id: true, title: true },
    });
    for (const listing of listings) {
      listingPathMap.set(listing.id, publicListingPath(listing.id, listing.title));
    }
  }

  if (sellerTargetIds.length > 0) {
    const sellers = await sellerProfileStaffReportTargets(staffClient, {
      actorId: staff.id,
      sellerProfileIds: sellerTargetIds,
    });
    for (const seller of sellers) {
      sellerPathMap.set(seller.id, publicSellerPath(seller.id, seller.displayName));
    }
  }

  if (blogCommentTargetIds.length > 0) {
    const comments = await prisma.blogComment.findMany({
      where: { id: { in: blogCommentTargetIds } },
      select: { id: true, post: { select: { slug: true } } },
    });
    for (const bc of comments) {
      blogCommentSlugMap.set(bc.id, bc.post.slug);
    }
  }

  const reporterUsers = topReporters.length > 0
    ? await userStaffReportLabels(staffClient, {
        actorId: staff.id,
        userIds: topReporters.map((r) => r.reporterId),
      })
    : [];
  const reporterMap = new Map(reporterUsers.map((u) => [u.id, u]));

  return (
    <main className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-semibold font-display mb-2">User Reports ({openCount} open)</h1>
      <p className="mb-6 text-sm text-neutral-500">Oldest unresolved reports are shown first.</p>

      {/* Top reporters — abuse detection */}
      {topReporters.length > 0 && topReporters[0].count >= 3 && (
        <div className="card-section p-4 mb-6">
          <h2 className="text-sm font-semibold text-neutral-700 mb-2">Top reporters (last 30 days)</h2>
          <div className="flex flex-wrap gap-3">
            {topReporters.map((tr) => {
              const u = reporterMap.get(tr.reporterId);
              return (
                <div key={tr.reporterId} className="text-xs text-neutral-600">
                  <span className="font-medium">{reportUserLabel(u)}</span>
                  {" "}
                  <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tr.count >= 10 ? "bg-red-100 text-red-700" : tr.count >= 5 ? "bg-amber-100 text-amber-700" : "bg-neutral-100 text-neutral-600"}`}>
                    {tr.count} reports
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {reports.map((r) => (
          <div key={r.id} className="border border-neutral-200 rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm">
                  <span className="font-medium">{reportUserLabel(reportUserById.get(r.reporterId))}</span>
                  <span className="text-neutral-500"> reported </span>
                  <Link href={`/admin/users?q=${encodeURIComponent(reportUserSearchValue(reportUserById.get(r.reportedId)))}`} className="font-medium hover:underline">{reportUserLabel(reportUserById.get(r.reportedId))}</Link>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
                    {r.reason}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {new Date(r.createdAt).toLocaleDateString("en-US")}
                  </span>
                </div>
                {r.details && (
                  <p className="text-sm text-neutral-600">{r.details}</p>
                )}
                {r.targetType && r.targetId && (
                  <div>
                    {/* Listing links use the staff preview so hidden, held or rejected
                        listings still open; targets known to be gone render as text. */}
                    {r.targetType === "LISTING" && (
                      listingPathMap.has(r.targetId) ? (
                        <Link href={`${listingPathMap.get(r.targetId)}?preview=admin`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">View listing →</Link>
                      ) : (
                        <span className="text-xs text-neutral-500">Listing no longer exists</span>
                      )
                    )}
                    {isSellerProfileReportTarget(r.targetType) && (
                      reportUserById.get(r.reportedId)?.deletedAt ? (
                        <span className="text-xs text-neutral-500">Seller account deleted</span>
                      ) : sellerPathMap.has(r.targetId) ? (
                        <Link href={sellerPathMap.get(r.targetId)!} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">View seller →</Link>
                      ) : (
                        <span className="text-xs text-neutral-500">Seller profile no longer exists</span>
                      )
                    )}
                    {r.targetType === "MESSAGE_THREAD" && (
                      <Link href={`/messages/${r.targetId}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">View thread →</Link>
                    )}
                    {r.targetType === "BLOG_POST" && (
                      <Link href={`/blog/${r.targetId}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">View post →</Link>
                    )}
                    {r.targetType === "REVIEW" && reviewListingMap.has(r.targetId) && (
                      <Link href={`${publicListingPath(reviewListingMap.get(r.targetId)!.id, reviewListingMap.get(r.targetId)!.title)}?preview=admin#reviews`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">View review →</Link>
                    )}
                    {r.targetType === "BLOG_COMMENT" && blogCommentSlugMap.has(r.targetId) && (
                      <Link href={`/blog/${blogCommentSlugMap.get(r.targetId)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">View blog post →</Link>
                    )}
                  </div>
                )}
              </div>
              <ResolveReportButton reportId={r.id} />
            </div>
          </div>
        ))}
        {reports.length === 0 && (
          <p className="text-neutral-500 text-sm">No open reports.</p>
        )}
      </div>
      {reports.length === REPORT_PAGE_SIZE && (() => {
        const last = reports.at(-1)!;
        const href = new URLSearchParams({
          afterCreatedAt: last.createdAt.toISOString(),
          afterId: last.id,
        });
        return (
          <div className="mt-6 flex justify-end">
            <Link
              href={`/admin/reports?${href.toString()}`}
              className="rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Next {REPORT_PAGE_SIZE} →
            </Link>
          </div>
        );
      })()}
    </main>
  );
}

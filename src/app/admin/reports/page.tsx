import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import { ResolveReportButton } from "@/components/admin/ResolveReportButton";

export const metadata: Metadata = { title: "Reports — Admin" };

export default async function AdminReportsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true },
  });
  if (!admin || (admin.role !== "ADMIN" && admin.role !== "EMPLOYEE")) redirect("/");

  const reports = await prisma.userReport.findMany({
    where: { resolved: false },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      reason: true,
      details: true,
      targetType: true,
      targetId: true,
      createdAt: true,
      reporter: { select: { name: true, email: true } },
      reported: { select: { name: true, email: true } },
    },
  });

  // Batch-resolve context URLs for REVIEW and BLOG_COMMENT reports
  const reviewTargetIds = reports
    .filter((r) => r.targetType === "REVIEW" && r.targetId)
    .map((r) => r.targetId!);
  const blogCommentTargetIds = reports
    .filter((r) => r.targetType === "BLOG_COMMENT" && r.targetId)
    .map((r) => r.targetId!);

  const reviewListingMap = new Map<string, string>();
  const blogCommentSlugMap = new Map<string, string>();

  if (reviewTargetIds.length > 0) {
    const reviews = await prisma.review.findMany({
      where: { id: { in: reviewTargetIds } },
      select: { id: true, listingId: true },
    });
    for (const rv of reviews) {
      reviewListingMap.set(rv.id, rv.listingId);
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

  return (
    <main className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-semibold font-display mb-6">User Reports ({reports.length} open)</h1>
      <div className="space-y-3">
        {reports.map((r) => (
          <div key={r.id} className="border border-neutral-200 rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm">
                  <span className="font-medium">{r.reporter.name ?? r.reporter.email ?? "Unknown"}</span>
                  <span className="text-neutral-400"> reported </span>
                  <Link href={`/admin/users?q=${encodeURIComponent(r.reported.email ?? r.reported.name ?? "")}`} className="font-medium hover:underline">{r.reported.name ?? r.reported.email ?? "Unknown"}</Link>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
                    {r.reason}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {r.details && (
                  <p className="text-sm text-neutral-600">{r.details}</p>
                )}
                {r.targetType && r.targetId && (
                  <div>
                    {r.targetType === "LISTING" && (
                      <Link href={`/listing/${r.targetId}`} target="_blank" className="text-xs text-blue-600 hover:underline">View listing →</Link>
                    )}
                    {r.targetType === "SELLER" && (
                      <Link href={`/seller/${r.targetId}`} target="_blank" className="text-xs text-blue-600 hover:underline">View seller →</Link>
                    )}
                    {r.targetType === "MESSAGE_THREAD" && (
                      <Link href={`/messages/${r.targetId}`} target="_blank" className="text-xs text-blue-600 hover:underline">View thread →</Link>
                    )}
                    {r.targetType === "BLOG_POST" && (
                      <Link href={`/blog/${r.targetId}`} target="_blank" className="text-xs text-blue-600 hover:underline">View post →</Link>
                    )}
                    {r.targetType === "REVIEW" && reviewListingMap.has(r.targetId) && (
                      <Link href={`/listing/${reviewListingMap.get(r.targetId)}#reviews`} target="_blank" className="text-xs text-blue-600 hover:underline">View review →</Link>
                    )}
                    {r.targetType === "BLOG_COMMENT" && blogCommentSlugMap.has(r.targetId) && (
                      <Link href={`/blog/${blogCommentSlugMap.get(r.targetId)}`} target="_blank" className="text-xs text-blue-600 hover:underline">View blog post →</Link>
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
    </main>
  );
}

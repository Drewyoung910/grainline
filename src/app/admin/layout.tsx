import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { Package, AlertTriangle, Shield, Edit, Rss, Eye, User, Star } from "@/components/icons";
import AdminMobileNav from "@/components/AdminMobileNav";
import AdminPinGate from "@/components/AdminPinGate";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Defense in depth: re-check role here in addition to middleware
  const { userId } = await auth();
  if (!userId) redirect("/");

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true },
  });
  if (!user || (user.role !== "EMPLOYEE" && user.role !== "ADMIN")) redirect("/");

  const [openCaseCount, pendingVerificationCount, pendingCommentCount, pendingReviewCount] = await Promise.all([
    prisma.case.count({
      where: { status: { in: ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"] } },
    }),
    prisma.makerVerification.count({ where: { status: "PENDING" } }),
    prisma.blogComment.count({ where: { approved: false } }),
    prisma.listing.count({ where: { status: "PENDING_REVIEW" } }),
  ]);

  return (
    <AdminPinGate>
    <div className="flex flex-col md:flex-row min-h-screen bg-neutral-100">
      {/* ── Mobile tab strip (< md) ── */}
      <AdminMobileNav
        openCaseCount={openCaseCount}
        pendingVerificationCount={pendingVerificationCount}
        pendingCommentCount={pendingCommentCount}
        pendingReviewCount={pendingReviewCount}
      />

      {/* ── Desktop sidebar (md+) ── */}
      <aside className="hidden md:block w-52 shrink-0 border-r border-neutral-200 bg-white px-3 py-8">
        <div className="px-2 mb-5">
          <span className="text-xs font-semibold uppercase tracking-widest text-neutral-400">
            Admin
          </span>
        </div>
        <nav className="space-y-0.5">
          <Link
            href="/admin/flagged"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <AlertTriangle size={16} className="shrink-0 text-amber-500" />
            Flagged Orders
          </Link>
          <Link
            href="/admin/orders"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <Package size={16} className="shrink-0 text-neutral-400" />
            All Orders
          </Link>
          <Link
            href="/admin/cases"
            className="flex items-center justify-between rounded-md px-2 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0 text-neutral-400" />
              Cases
            </div>
            {openCaseCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                {openCaseCount}
              </span>
            )}
          </Link>
          <Link
            href="/admin/verification"
            className="flex items-center justify-between rounded-md px-2 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <div className="flex items-center gap-2">
              <Shield size={16} className="shrink-0 text-neutral-400" />
              Verification
            </div>
            {pendingVerificationCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                {pendingVerificationCount}
              </span>
            )}
          </Link>
          <Link
            href="/admin/blog"
            className="flex items-center justify-between rounded-md px-2 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <div className="flex items-center gap-2">
              <Edit size={16} className="shrink-0 text-neutral-400" />
              Blog
            </div>
            {pendingCommentCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                {pendingCommentCount}
              </span>
            )}
          </Link>
          <Link
            href="/admin/broadcasts"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <Rss size={16} className="shrink-0 text-neutral-400" />
            Broadcasts
          </Link>
          <Link
            href="/admin/review"
            className="flex items-center justify-between rounded-md px-2 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <div className="flex items-center gap-2">
              <Eye size={16} className="shrink-0 text-neutral-400" />
              Review Queue
            </div>
            {pendingReviewCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                {pendingReviewCount}
              </span>
            )}
          </Link>
          <Link
            href="/admin/reviews"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <Star size={16} className="shrink-0 text-neutral-400" />
            Reviews
          </Link>
          <Link
            href="/admin/reports"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <AlertTriangle size={16} className="shrink-0 text-neutral-400" />
            Reports
          </Link>
          <Link
            href="/admin/users"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <User size={16} className="shrink-0 text-neutral-400" />
            Users
          </Link>
          <Link
            href="/admin/audit"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <Shield size={16} className="shrink-0 text-neutral-400" />
            Audit Log
          </Link>
        </nav>
      </aside>

      <div className="flex-1 overflow-auto p-4 md:p-8">{children}</div>
    </div>
    </AdminPinGate>
  );
}

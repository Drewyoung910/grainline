import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { userClerkGate } from "@/lib/userIdentityAccess";
import { Package, AlertTriangle, Shield, Edit, Rss, Eye, User, Star, File } from "@/components/icons";
import AdminMobileNav from "@/components/AdminMobileNav";
import AdminSidebarLink from "@/components/AdminSidebarLink";
import AdminPinGate from "@/components/AdminPinGate";
import { ADMIN_PIN_COOKIE_NAME, verifyAdminPinCookieValue } from "@/lib/adminPin";
import { getStaffActiveCaseCount } from "@/lib/caseReadAuthority";
import { readStaffOrderPage } from "@/lib/orderStaffReadAuthority";
import { getOrderStaffReadClient } from "@/lib/orderStaffReadDb";
import { readSupportRequestStaffState } from "@/lib/supportRequestAccess";
import { makerVerificationStaffPendingCount } from "@/lib/makerVerificationAccess";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Defense in depth: re-check role here in addition to middleware
  const { userId, sessionId } = await auth();
  if (!userId) redirect("/");

  const user = await userClerkGate(prisma, userId);
  if (!user || user.banned || user.deletedAt || (user.role !== "EMPLOYEE" && user.role !== "ADMIN")) redirect("/");

  const cookieStore = await cookies();
  const pinVerified = await verifyAdminPinCookieValue(
    cookieStore.get(ADMIN_PIN_COOKIE_NAME)?.value,
    userId,
    sessionId,
  );

  if (!pinVerified) {
    return <AdminPinGate />;
  }

  const [openCaseCountResult, reviewNeededOrders, pendingVerificationCount, pendingCommentCount, pendingReviewCount, openSupportRequestCount] = await Promise.all([
    getStaffActiveCaseCount(user.id),
    readStaffOrderPage(user.id, "REVIEW_NEEDED", 1, 1, getOrderStaffReadClient()),
    makerVerificationStaffPendingCount(getOrderStaffReadClient(), user.id),
    prisma.blogComment.count({ where: { approved: false } }),
    prisma.listing.count({ where: { status: "PENDING_REVIEW" } }),
    readSupportRequestStaffState(user.id, 1, 0, 0).then((state) => state.activeCount),
  ]);
  if (openCaseCountResult === null || reviewNeededOrders === null) redirect("/");
  const openCaseCount = openCaseCountResult;
  const reviewNeededOrderCount = reviewNeededOrders.totalCount;

  return (
    <div className="flex flex-col md:flex-row min-h-[100svh] bg-neutral-100">
      {/* ── Mobile tab strip (< md) ── */}
      <AdminMobileNav
        openCaseCount={openCaseCount}
        reviewNeededOrderCount={reviewNeededOrderCount}
        pendingVerificationCount={pendingVerificationCount}
        pendingCommentCount={pendingCommentCount}
        pendingReviewCount={pendingReviewCount}
        openSupportRequestCount={openSupportRequestCount}
      />

      {/* ── Desktop sidebar (md+) ── */}
      <aside className="hidden md:block w-52 shrink-0 border-r border-neutral-200 bg-white px-3 py-8">
        <div className="px-2 mb-5">
          <span className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
            Admin
          </span>
        </div>
        <nav className="space-y-0.5">
          <AdminSidebarLink
            href="/admin/flagged"
            className="flex items-center justify-between rounded-md px-2 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0 text-amber-500" />
              Orders Needing Review
            </div>
            {reviewNeededOrderCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                {reviewNeededOrderCount > 99 ? "99+" : reviewNeededOrderCount}
              </span>
            )}
          </AdminSidebarLink>
          <AdminSidebarLink
            href="/admin/orders"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm"
          >
            <Package size={16} className="shrink-0 text-neutral-500" />
            All Orders
          </AdminSidebarLink>
          <AdminSidebarLink
            href="/admin/cases"
            className="flex items-center justify-between rounded-md px-2 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0 text-neutral-500" />
              Cases
            </div>
            {openCaseCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                {openCaseCount}
              </span>
            )}
          </AdminSidebarLink>
          <AdminSidebarLink
            href="/admin/verification"
            className="flex items-center justify-between rounded-md px-2 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <Shield size={16} className="shrink-0 text-neutral-500" />
              Verification
            </div>
            {pendingVerificationCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                {pendingVerificationCount}
              </span>
            )}
          </AdminSidebarLink>
          <AdminSidebarLink
            href="/admin/blog"
            className="flex items-center justify-between rounded-md px-2 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <Edit size={16} className="shrink-0 text-neutral-500" />
              Blog
            </div>
            {pendingCommentCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                {pendingCommentCount}
              </span>
            )}
          </AdminSidebarLink>
          <AdminSidebarLink
            href="/admin/broadcasts"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm"
          >
            <Rss size={16} className="shrink-0 text-neutral-500" />
            Broadcasts
          </AdminSidebarLink>
          <AdminSidebarLink
            href="/admin/review"
            className="flex items-center justify-between rounded-md px-2 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <Eye size={16} className="shrink-0 text-neutral-500" />
              Review Queue
            </div>
            {pendingReviewCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                {pendingReviewCount}
              </span>
            )}
          </AdminSidebarLink>
          <AdminSidebarLink
            href="/admin/reviews"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm"
          >
            <Star size={16} className="shrink-0 text-neutral-500" />
            Reviews
          </AdminSidebarLink>
          <AdminSidebarLink
            href="/admin/reports"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm"
          >
            <AlertTriangle size={16} className="shrink-0 text-neutral-500" />
            Reports
          </AdminSidebarLink>
          <AdminSidebarLink
            href="/admin/support"
            className="flex items-center justify-between rounded-md px-2 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <File size={16} className="shrink-0 text-neutral-500" />
              Support
            </div>
            {openSupportRequestCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                {openSupportRequestCount}
              </span>
            )}
          </AdminSidebarLink>
          <AdminSidebarLink
            href="/admin/users"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm"
          >
            <User size={16} className="shrink-0 text-neutral-500" />
            Users
          </AdminSidebarLink>
          <AdminSidebarLink
            href="/admin/audit"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm"
          >
            <Shield size={16} className="shrink-0 text-neutral-500" />
            Audit Log
          </AdminSidebarLink>
        </nav>
      </aside>

      <div className="flex-1 overflow-auto p-4 md:p-8">{children}</div>
    </div>
  );
}

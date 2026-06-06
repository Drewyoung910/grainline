// src/app/admin/broadcasts/page.tsx
import { prisma } from "@/lib/db";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import DeleteBroadcastButton from "./DeleteBroadcastButton";
import { logAdminActionOrThrow } from "@/lib/audit";
import { publicSellerPath } from "@/lib/publicPaths";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";
import { adminActionRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { truncateText, truncateTextWithEllipsis } from "@/lib/sanitize";
import { sellerBroadcastEmailSubject } from "@/lib/email";
import { requireAdminPageAccess } from "@/lib/adminPageAccess";

async function deleteBroadcast(formData: FormData) {
  "use server";
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { success } = await safeRateLimit(adminActionRatelimit, userId);
  if (!success) return;
  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!user || user.banned || user.deletedAt || (user.role !== "EMPLOYEE" && user.role !== "ADMIN")) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (id) {
    await prisma.$transaction(async (tx) => {
      const broadcast = await tx.sellerBroadcast.findUnique({
        where: { id },
        select: {
          id: true,
          sellerProfileId: true,
          message: true,
          sentAt: true,
          recipientCount: true,
          sellerProfile: { select: { displayName: true } },
        },
      });
      if (!broadcast) return;
      const deleted = await tx.sellerBroadcast.deleteMany({ where: { id } });
      if (deleted.count !== 1) return;
      const sellerName = broadcast.sellerProfile.displayName ?? "A maker you follow";
      const staleNotificationWindowEnd = new Date(broadcast.sentAt.getTime() + 60 * 60 * 1000);
      await tx.notification.deleteMany({
        where: {
          type: "SELLER_BROADCAST",
          title: `Update from ${sellerName}`,
          body: truncateTextWithEllipsis(broadcast.message, 100),
          createdAt: { gte: broadcast.sentAt, lte: staleNotificationWindowEnd },
          OR: [
            { link: `/account/feed?broadcast=${broadcast.id}` },
            { link: "/account/feed" },
          ],
        },
      });
      await tx.emailOutbox.deleteMany({
        where: {
          preferenceKey: "EMAIL_SELLER_BROADCAST",
          subject: sellerBroadcastEmailSubject(sellerName),
          status: { in: ["PENDING", "FAILED"] },
          createdAt: { gte: broadcast.sentAt, lte: staleNotificationWindowEnd },
        },
      });
      await logAdminActionOrThrow({
        client: tx,
        adminId: user.id,
        action: "DELETE_BROADCAST",
        targetType: "SELLER_BROADCAST",
        targetId: broadcast.id,
        metadata: {
          sellerProfileId: broadcast.sellerProfileId,
          recipientCount: broadcast.recipientCount,
        },
      });
    });
  }
  revalidatePath("/admin/broadcasts");
}

export default async function AdminBroadcastsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  await requireAdminPageAccess();
  const sp = await searchParams;
  const requestedPage = parseBoundedPositiveIntParam(sp.page, 1, 1000);
  const q = truncateText((sp.q ?? "").trim(), 200);
  const pageSize = 25;

  const where = q
    ? { message: { contains: q, mode: "insensitive" as const } }
    : {};

  const total = await prisma.sellerBroadcast.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);

  const broadcasts = await prisma.sellerBroadcast.findMany({
    where,
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      message: true,
      imageUrl: true,
      sentAt: true,
      recipientCount: true,
      sellerProfile: {
        select: {
          id: true,
          displayName: true,
          user: { select: { email: true } },
        },
      },
    },
  });

  function buildHref(overrides: Record<string, string>) {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (page > 1) p.set("page", String(page));
    for (const [k, v] of Object.entries(overrides)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    const qs = p.toString();
    return `/admin/broadcasts${qs ? `?${qs}` : ""}`;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Shop Broadcasts</h1>
        <span className="text-sm text-neutral-500">{total} total</span>
      </div>

      {/* Search */}
      <form method="get" className="mb-6 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          maxLength={200}
          placeholder="Search message text…"
          className="flex-1 border rounded-lg px-3 py-2 text-sm"
        />
        <button type="submit" className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm">
          Search
        </button>
        {q && (
          <Link href="/admin/broadcasts" className="px-4 py-2 rounded-lg border text-sm hover:bg-neutral-50">
            Clear
          </Link>
        )}
      </form>

      {broadcasts.length === 0 ? (
        <div className="card-section p-10 text-center text-neutral-500">
          No broadcasts found.
        </div>
      ) : (
        <div className="space-y-3">
          {broadcasts.map((b) => (
            <div key={b.id} className="card-section p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Link
                      href={b.sellerProfile ? publicSellerPath(b.sellerProfile.id, b.sellerProfile.displayName) : "#"}
                      className="text-sm font-medium text-neutral-800 hover:underline"
                    >
                      {b.sellerProfile?.displayName ?? "Unknown maker"}
                    </Link>
                    <span className="text-xs text-neutral-500">
                      {b.sellerProfile?.user?.email}
                    </span>
                    <span className="text-xs text-neutral-300">·</span>
                    <span className="text-xs text-neutral-500">
                      {new Date(b.sentAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="text-xs text-neutral-300">·</span>
                    <span className="text-xs text-neutral-500">
                      {b.recipientCount} recipient{b.recipientCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-700 whitespace-pre-line">{b.message}</p>
                  {b.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={b.imageUrl}
                      alt="Broadcast attachment"
                      className="mt-2 rounded-lg max-h-40 object-cover"
                    />
                  )}
                </div>
                <DeleteBroadcastButton id={b.id} action={deleteBroadcast} />
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-8">
          {page > 1 && (
            <Link href={buildHref({ page: String(page - 1) })} className="rounded-lg border px-4 py-2 text-sm hover:bg-neutral-50">
              ← Previous
            </Link>
          )}
          <span className="rounded-lg border px-4 py-2 text-sm bg-neutral-50 text-neutral-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={buildHref({ page: String(page + 1) })} className="rounded-lg border px-4 py-2 text-sm hover:bg-neutral-50">
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

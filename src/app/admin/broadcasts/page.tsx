// src/app/admin/broadcasts/page.tsx
import { prisma } from "@/lib/db";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import DeleteBroadcastButton from "./DeleteBroadcastButton";
import { logAdminAction } from "@/lib/audit";

async function deleteBroadcast(formData: FormData) {
  "use server";
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const user = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true, role: true } });
  if (!user || (user.role !== "EMPLOYEE" && user.role !== "ADMIN")) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (id) {
    const deleted = await prisma.sellerBroadcast.delete({
      where: { id },
      select: { id: true, sellerProfileId: true, recipientCount: true },
    });
    await logAdminAction({
      adminId: user.id,
      action: "DELETE_BROADCAST",
      targetType: "SELLER_BROADCAST",
      targetId: deleted.id,
      metadata: {
        sellerProfileId: deleted.sellerProfileId,
        recipientCount: deleted.recipientCount,
      },
    });
  }
  revalidatePath("/admin/broadcasts");
}

export default async function AdminBroadcastsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));
  const q = sp.q?.trim() ?? "";
  const pageSize = 25;

  const where = q
    ? { message: { contains: q, mode: "insensitive" as const } }
    : {};

  const [broadcasts, total] = await Promise.all([
    prisma.sellerBroadcast.findMany({
      where,
      orderBy: { sentAt: "desc" },
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
    }),
    prisma.sellerBroadcast.count({ where }),
  ]);

  const totalPages = Math.ceil(total / pageSize);

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
                      href={`/seller/${b.sellerProfile?.id}`}
                      className="text-sm font-medium text-neutral-800 hover:underline"
                    >
                      {b.sellerProfile?.displayName ?? "Unknown maker"}
                    </Link>
                    <span className="text-xs text-neutral-400">
                      {b.sellerProfile?.user?.email}
                    </span>
                    <span className="text-xs text-neutral-300">·</span>
                    <span className="text-xs text-neutral-400">
                      {new Date(b.sentAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="text-xs text-neutral-300">·</span>
                    <span className="text-xs text-neutral-400">
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

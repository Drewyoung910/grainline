import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import { unblockUser } from "./actions";

export const metadata: Metadata = { title: "Blocked Users" };

export default async function BlockedUsersPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account/blocked");

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) redirect("/sign-in");

  const blocks = await prisma.block.findMany({
    where: { blockerId: me.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      blockedId: true,
      blocked: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          sellerProfile: {
            select: { displayName: true, avatarImageUrl: true },
          },
        },
      },
    },
  });

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link href="/account" className="text-sm text-neutral-500 hover:underline">← My Account</Link>
        <h1 className="text-2xl font-display font-semibold text-neutral-900 mt-2">Blocked Users</h1>
        <p className="text-sm text-neutral-500 mt-1">{blocks.length} blocked user{blocks.length !== 1 ? "s" : ""}</p>
      </div>

      {blocks.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-neutral-500 text-sm">You haven&apos;t blocked anyone.</p>
          <Link href="/map" className="mt-4 inline-block text-sm text-neutral-700 hover:underline">
            Browse makers →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {blocks.map((b) => {
            const u = b.blocked;
            const avatar = u.sellerProfile?.avatarImageUrl ?? u.imageUrl;
            const name = u.sellerProfile?.displayName ?? u.name ?? "User";
            const initials = name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w: string) => w[0]?.toUpperCase() ?? "")
              .join("") || "U";

            return (
              <div key={b.id} className="card-section p-4 flex gap-4 items-center">
                <div className="h-10 w-10 shrink-0 rounded-full bg-neutral-200 overflow-hidden flex items-center justify-center">
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatar} alt={name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs font-medium text-neutral-700">{initials}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-neutral-900">{name}</p>
                </div>
                <form action={unblockUser.bind(null, b.blockedId)}>
                  <button
                    type="submit"
                    className="text-sm border border-neutral-200 rounded-md px-3 py-1.5 hover:bg-neutral-50 transition-colors"
                  >
                    Unblock
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

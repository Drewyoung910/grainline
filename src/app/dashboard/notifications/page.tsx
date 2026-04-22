// src/app/dashboard/notifications/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { prisma } from "@/lib/db";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

import {
  Bell,
  Package,
  MessageCircle,
  Heart,
  Wrench,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Star,
  Edit,
  User,
} from "@/components/icons";
import type { NotificationType } from "@prisma/client";
import LocalDate from "@/components/LocalDate";

const PAGE_SIZE = 20;

function typeIcon(type: NotificationType) {
  switch (type) {
    case "NEW_ORDER":
    case "ORDER_SHIPPED":
    case "ORDER_DELIVERED":
      return { Icon: Package, color: "text-green-600" };
    case "NEW_MESSAGE":
    case "CASE_MESSAGE":
      return { Icon: MessageCircle, color: "text-blue-600" };
    case "NEW_FAVORITE":
      return { Icon: Heart, color: "text-red-500" };
    case "CUSTOM_ORDER_REQUEST":
    case "CUSTOM_ORDER_LINK":
      return { Icon: Wrench, color: "text-amber-600" };
    case "CASE_OPENED":
    case "CASE_RESOLVED":
      return { Icon: AlertTriangle, color: "text-amber-500" };
    case "VERIFICATION_APPROVED":
      return { Icon: CheckCircle, color: "text-green-600" };
    case "VERIFICATION_REJECTED":
      return { Icon: XCircle, color: "text-red-500" };
    case "BACK_IN_STOCK":
    case "LOW_STOCK":
      return { Icon: Bell, color: "text-neutral-500" };
    case "NEW_REVIEW":
      return { Icon: Star, color: "text-amber-500" };
    case "NEW_BLOG_COMMENT":
    case "BLOG_COMMENT_REPLY":
      return { Icon: Edit, color: "text-neutral-500" };
    case "NEW_FOLLOWER":
      return { Icon: User, color: "text-neutral-500" };
    default:
      return { Icon: Bell, color: "text-neutral-500" };
  }
}

async function markAllRead() {
  "use server";
  const { userId } = await auth();
  if (!userId) return;
  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) return;
  await prisma.notification.updateMany({
    where: { userId: me.id, read: false },
    data: { read: true },
  });
  revalidatePath("/dashboard/notifications");
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/notifications");

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) redirect("/sign-in");

  const { page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.notification.count({ where: { userId: me.id } }),
    prisma.notification.count({ where: { userId: me.id, read: false } }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <main className="max-w-2xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-neutral-500 mt-0.5">{unreadCount} unread</p>
          )}
        </div>
        {unreadCount > 0 && (
          <form action={markAllRead}>
            <button className="text-sm text-blue-600 hover:underline">
              Mark all as read
            </button>
          </form>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="card-section p-10 text-center text-neutral-500 text-sm">
          No notifications yet — check back after your first sale or message.
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100 card-section overflow-hidden">
          {notifications.map((n) => {
            const { Icon, color } = typeIcon(n.type);
            const row = (
              <li
                key={n.id}
                className={`flex items-start gap-4 px-5 py-4 ${!n.read ? "bg-amber-50" : "bg-white"}`}
              >
                {!n.read && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                )}
                {n.read && <span className="mt-1.5 h-2 w-2 shrink-0" />}
                <Icon size={18} className={`mt-0.5 shrink-0 ${color}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight">{n.title}</p>
                  <p className="text-sm text-neutral-600 mt-0.5">{n.body}</p>
                  <p className="text-xs text-neutral-400 mt-1">
                    <LocalDate date={n.createdAt} />
                  </p>
                </div>
              </li>
            );

            if (n.link) {
              return (
                <Link key={n.id} href={n.link} className="block hover:bg-neutral-50">
                  {row}
                </Link>
              );
            }
            return row;
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-8">
          {page > 1 && (
            <Link
              href={`/dashboard/notifications?page=${page - 1}`}
              className="rounded-md border border-neutral-200 px-3 py-1 text-sm hover:bg-neutral-50"
            >
              Previous
            </Link>
          )}
          <span className="text-sm text-neutral-500 py-1">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/dashboard/notifications?page=${page + 1}`}
              className="rounded-md border border-neutral-200 px-3 py-1 text-sm hover:bg-neutral-50"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </main>
  );
}

"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logAdminActionOrThrow } from "@/lib/audit";
import { adminActionRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { logServerError } from "@/lib/serverErrorLogger";

export type AdminOrderActionState = { ok: boolean; error?: string };

const ORDER_NOTE_MAX_CHARS = 2_000;
const ORDER_REVIEW_NOTE_MAX_CHARS = 10_000;

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const { success } = await safeRateLimit(adminActionRatelimit, userId);
  if (!success) throw new Error("Rate limited");
  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (
    !user ||
    user.banned ||
    user.deletedAt ||
    (user.role !== "EMPLOYEE" && user.role !== "ADMIN")
  ) {
    throw new Error("Forbidden");
  }
  return user;
}

export async function markReviewed(orderId: string, _prevState?: unknown): Promise<AdminOrderActionState> {
  try {
    const admin = await requireAdmin();
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: {
          id: orderId,
          reviewNeeded: true,
          NOT: { labelClawbackStatus: { in: ["RETRY_PENDING", "RETRYING"] } },
        },
        data: { reviewNeeded: false },
      });
      if (result.count === 0) return result;
      await logAdminActionOrThrow({
        client: tx,
        adminId: admin.id,
        action: "MARK_ORDER_REVIEWED",
        targetType: "ORDER",
        targetId: orderId,
      });
      return result;
    });
    if (updated.count === 0) {
      return {
        ok: false,
        error: "Order is already reviewed, no longer exists, or still has active label-cost reconciliation.",
      };
    }
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/flagged");
    revalidatePath("/admin/orders");
    return { ok: true };
  } catch (error) {
    logServerError(error, {
      source: "admin_order_mark_reviewed",
      extra: { orderId },
    });
    return { ok: false, error: "Could not mark this order reviewed." };
  }
}

export async function appendNote(orderId: string, _prevState: unknown, formData: FormData): Promise<AdminOrderActionState> {
  try {
    const admin = await requireAdmin();
    const note = String(formData.get("note") ?? "").trim();
    if (!note) return { ok: false, error: "Enter a note before appending." };
    if (note.length > ORDER_NOTE_MAX_CHARS) {
      return { ok: false, error: `Notes are limited to ${ORDER_NOTE_MAX_CHARS.toLocaleString("en-US")} characters per append.` };
    }

    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { reviewNote: true },
      });
      if (!order) return { status: "missing" as const };

      const existing = order.reviewNote ?? "";
      const updated = existing ? `${existing}\n\n[${timestamp}]\n${note}` : `[${timestamp}]\n${note}`;
      if (updated.length > ORDER_REVIEW_NOTE_MAX_CHARS) {
        return { status: "too_long" as const };
      }

      const updatedOrder = await tx.order.updateMany({
        where: { id: orderId, reviewNote: order.reviewNote },
        data: { reviewNote: updated },
      });
      if (updatedOrder.count === 0) return { status: "stale" as const };
      await logAdminActionOrThrow({
        client: tx,
        adminId: admin.id,
        action: "APPEND_ORDER_NOTE",
        targetType: "ORDER",
        targetId: orderId,
      });
      return { status: "updated" as const };
    });

    if (result.status === "missing") return { ok: false, error: "Order not found." };
    if (result.status === "too_long") {
      return {
        ok: false,
        error: `This order already has too many review notes. Keep total notes under ${ORDER_REVIEW_NOTE_MAX_CHARS.toLocaleString("en-US")} characters.`,
      };
    }
    if (result.status === "stale") return { ok: false, error: "Order notes changed; refresh and try again." };
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (error) {
    logServerError(error, {
      source: "admin_order_append_note",
      extra: { orderId },
    });
    return { ok: false, error: "Could not append this note." };
  }
}

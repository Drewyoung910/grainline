"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/audit";

export type AdminOrderActionState = { ok: boolean; error?: string };

const ORDER_NOTE_MAX_CHARS = 2_000;
const ORDER_REVIEW_NOTE_MAX_CHARS = 10_000;

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true },
  });
  if (!user || (user.role !== "EMPLOYEE" && user.role !== "ADMIN")) {
    throw new Error("Forbidden");
  }
  return user;
}

export async function markReviewed(orderId: string, _prevState?: unknown): Promise<AdminOrderActionState> {
  try {
    const admin = await requireAdmin();
    const updated = await prisma.order.updateMany({
      where: { id: orderId, reviewNeeded: true },
      data: { reviewNeeded: false },
    });
    if (updated.count === 0) return { ok: false, error: "Order is already reviewed or no longer exists." };
    await logAdminAction({
      adminId: admin.id,
      action: "MARK_ORDER_REVIEWED",
      targetType: "ORDER",
      targetId: orderId,
    });
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/flagged");
    revalidatePath("/admin/orders");
    return { ok: true };
  } catch (error) {
    console.error("markReviewed failed:", error);
    return { ok: false, error: "Could not mark this order reviewed." };
  }
}

export async function appendNote(orderId: string, _prevState: unknown, formData: FormData): Promise<AdminOrderActionState> {
  try {
    const admin = await requireAdmin();
    const note = String(formData.get("note") ?? "").trim();
    if (!note) return { ok: false, error: "Enter a note before appending." };
    if (note.length > ORDER_NOTE_MAX_CHARS) {
      return { ok: false, error: `Notes are limited to ${ORDER_NOTE_MAX_CHARS.toLocaleString()} characters per append.` };
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { reviewNote: true },
    });
    if (!order) return { ok: false, error: "Order not found." };

    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
    const existing = order.reviewNote ?? "";
    const updated = existing ? `${existing}\n\n[${timestamp}]\n${note}` : `[${timestamp}]\n${note}`;
    if (updated.length > ORDER_REVIEW_NOTE_MAX_CHARS) {
      return {
        ok: false,
        error: `This order already has too many review notes. Keep total notes under ${ORDER_REVIEW_NOTE_MAX_CHARS.toLocaleString()} characters.`,
      };
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { reviewNote: updated },
    });
    await logAdminAction({
      adminId: admin.id,
      action: "APPEND_ORDER_NOTE",
      targetType: "ORDER",
      targetId: orderId,
    });
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (error) {
    console.error("appendNote failed:", error);
    return { ok: false, error: "Could not append this note." };
  }
}

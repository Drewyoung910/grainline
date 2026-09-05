"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { adminActionRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { logServerError } from "@/lib/serverErrorLogger";
import {
  appendStaffOrderNote,
  markStaffOrderReviewed,
  recordStaffOrderLabelVoided,
} from "@/lib/orderStaffMutationAuthority";

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
    const status = await markStaffOrderReviewed(admin.id, orderId);
    if (status === "unchanged") {
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

export async function recordLabelVoided(orderId: string, _prevState?: unknown): Promise<AdminOrderActionState> {
  try {
    const admin = await requireAdmin();
    const result = await recordStaffOrderLabelVoided(admin.id, orderId);

    if (result === "missing") return { ok: false, error: "Order not found." };
    if (result === "not_purchased") return { ok: false, error: "This order does not have a purchased Grainline label." };
    if (result === "active_clawback") {
      return { ok: false, error: "Resolve active label-cost reconciliation before voiding the label status." };
    }
    if (result === "too_long") {
      return {
        ok: false,
        error: `This order already has too many review notes. Keep total notes under ${ORDER_REVIEW_NOTE_MAX_CHARS.toLocaleString("en-US")} characters.`,
      };
    }
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/flagged");
    revalidatePath("/admin/orders");
    return { ok: true };
  } catch (error) {
    logServerError(error, {
      source: "admin_order_record_label_voided",
      extra: { orderId },
    });
    return { ok: false, error: "Could not record this label as voided." };
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

    const result = await appendStaffOrderNote(admin.id, orderId, note);

    if (result === "missing") return { ok: false, error: "Order not found." };
    if (result === "too_long") {
      return {
        ok: false,
        error: `This order already has too many review notes. Keep total notes under ${ORDER_REVIEW_NOTE_MAX_CHARS.toLocaleString("en-US")} characters.`,
      };
    }
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

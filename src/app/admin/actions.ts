"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/audit";

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

export async function markReviewed(orderId: string) {
  const admin = await requireAdmin();
  await prisma.order.update({
    where: { id: orderId },
    data: { reviewNeeded: false },
  });
  await logAdminAction({
    adminId: admin.id,
    action: "MARK_ORDER_REVIEWED",
    targetType: "ORDER",
    targetId: orderId,
  });
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/flagged");
  revalidatePath("/admin/orders");
}

export async function appendNote(orderId: string, formData: FormData) {
  const admin = await requireAdmin();
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { reviewNote: true },
  });

  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const existing = order?.reviewNote ?? "";
  const updated = existing ? `${existing}\n\n[${timestamp}]\n${note}` : `[${timestamp}]\n${note}`;

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
}

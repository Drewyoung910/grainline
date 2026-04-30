"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/audit";

export type SupportRequestActionState = { ok: boolean; error?: string };

type SupportRequestStatusValue = "OPEN" | "IN_PROGRESS" | "CLOSED";

const SUPPORT_REQUEST_STATUSES = new Set<SupportRequestStatusValue>(["OPEN", "IN_PROGRESS", "CLOSED"]);

function isSupportRequestStatus(status: string): status is SupportRequestStatusValue {
  return SUPPORT_REQUEST_STATUSES.has(status as SupportRequestStatusValue);
}

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

export async function setSupportRequestStatus(
  requestId: string,
  status: string,
  _prevState?: unknown,
): Promise<SupportRequestActionState> {
  try {
    if (!isSupportRequestStatus(status)) {
      return { ok: false, error: "Unsupported status." };
    }

    const admin = await requireAdmin();
    const updated = await prisma.supportRequest.updateMany({
      where: { id: requestId },
      data: {
        status,
        closedAt: status === "CLOSED" ? new Date() : null,
      },
    });

    if (updated.count === 0) {
      return { ok: false, error: "Request no longer exists." };
    }

    await logAdminAction({
      adminId: admin.id,
      action: "UPDATE_SUPPORT_REQUEST",
      targetType: "SUPPORT_REQUEST",
      targetId: requestId,
      metadata: { status },
    });

    revalidatePath("/admin/support");
    return { ok: true };
  } catch (error) {
    console.error("setSupportRequestStatus failed:", error);
    return { ok: false, error: "Could not update this request." };
  }
}

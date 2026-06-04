"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { normalizeSupportRequestClosureEvidence } from "@/lib/supportRequest";
import { logAdminActionOrThrow } from "@/lib/audit";
import { adminActionRatelimit, safeRateLimit } from "@/lib/ratelimit";
import {
  isSupportRequestStatus,
  supportRequestStatusTransition,
} from "@/lib/supportRequestState";
import { logServerError } from "@/lib/serverErrorLogger";

export type SupportRequestActionState = { ok: boolean; error?: string };

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

export async function setSupportRequestStatus(
  requestId: string,
  status: string,
  _prevState?: unknown,
  formData?: FormData,
): Promise<SupportRequestActionState> {
  try {
    if (!isSupportRequestStatus(status)) {
      return { ok: false, error: "Unsupported status." };
    }

    const admin = await requireAdmin();
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.supportRequest.findUnique({
        where: { id: requestId },
        select: { kind: true, status: true, closedAt: true },
      });
      if (!current) return { status: "missing" as const };

      const requiresClosureEvidence =
        current.kind === "DATA_REQUEST" &&
        current.status !== "CLOSED" &&
        status === "CLOSED";
      const closureEvidence = requiresClosureEvidence
        ? normalizeSupportRequestClosureEvidence(formData?.get("closureEvidence"))
        : null;
      if (closureEvidence && !closureEvidence.ok) {
        return { status: "missing_closure_evidence" as const, error: closureEvidence.error };
      }

      const now = new Date();
      const transition = supportRequestStatusTransition(current, status, now);
      if (!transition.ok) return { status: "closed_terminal" as const };

      const closureEvidenceData = closureEvidence?.ok
        ? {
            closureEvidence: closureEvidence.evidence,
            closureEvidenceAt: now,
            closureEvidenceById: admin.id,
          }
        : {};
      const result = await tx.supportRequest.updateMany({
        where: { id: requestId, status: current.status },
        data: { ...transition.data, ...closureEvidenceData },
      });
      if (result.count === 0) return { status: "conflict" as const };
      await logAdminActionOrThrow({
        client: tx,
        adminId: admin.id,
        action: "UPDATE_SUPPORT_REQUEST",
        targetType: "SUPPORT_REQUEST",
        targetId: requestId,
        metadata: {
          ...transition.metadata,
          ...(closureEvidence?.ok
            ? {
                closureEvidenceRecorded: true,
                closureEvidenceLength: closureEvidence.evidence.length,
                closureEvidenceAt: now.toISOString(),
              }
            : {}),
        },
      });
      return { status: "updated" as const };
    });

    if (updated.status === "missing") {
      return { ok: false, error: "Request no longer exists." };
    }
    if (updated.status === "closed_terminal") {
      return { ok: false, error: "Closed requests cannot be reopened." };
    }
    if (updated.status === "missing_closure_evidence") {
      return { ok: false, error: updated.error };
    }
    if (updated.status === "conflict") {
      return { ok: false, error: "Request changed before it could be updated. Try again." };
    }

    revalidatePath("/admin/support");
    return { ok: true };
  } catch (error) {
    logServerError(error, {
      source: "admin_support_status_update",
      extra: { requestId, status },
    });
    return { ok: false, error: "Could not update this request." };
  }
}

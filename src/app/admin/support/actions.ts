"use server";

import { revalidatePath } from "next/cache";
import { requireAdminPageAccess } from "@/lib/adminPageAccess";
import { normalizeSupportRequestClosureEvidence } from "@/lib/supportRequest";
import { adminActionRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { isSupportRequestStatus } from "@/lib/supportRequestState";
import { transitionSupportRequest } from "@/lib/supportRequestAccess";
import { logServerError } from "@/lib/serverErrorLogger";

export type SupportRequestActionState = { ok: boolean; error?: string };

async function requireAdmin() {
  const user = await requireAdminPageAccess();
  if (!user) throw new Error("Admin PIN required");
  const { success } = await safeRateLimit(adminActionRatelimit, user.id);
  if (!success) throw new Error("Rate limited");
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
    const rawEvidence = formData?.get("closureEvidence");
    const closureEvidence = typeof rawEvidence === "string" && rawEvidence.length > 0
      ? normalizeSupportRequestClosureEvidence(rawEvidence)
      : null;
    if (closureEvidence && !closureEvidence.ok) {
      return { ok: false, error: closureEvidence.error };
    }
    const updated = await transitionSupportRequest({
      actorUserId: admin.id,
      requestId,
      status,
      closureEvidence: closureEvidence?.ok ? closureEvidence.evidence : null,
    });

    if (updated === "missing") {
      return { ok: false, error: "Request no longer exists." };
    }
    if (updated === "closed_terminal") {
      return { ok: false, error: "Closed requests cannot be reopened." };
    }
    if (updated === "missing_closure_evidence") {
      return { ok: false, error: "Add closure evidence before closing this data request." };
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

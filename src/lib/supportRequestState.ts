export type SupportRequestStatusValue = "OPEN" | "IN_PROGRESS" | "CLOSED";

const SUPPORT_REQUEST_STATUSES = new Set<SupportRequestStatusValue>(["OPEN", "IN_PROGRESS", "CLOSED"]);

export function isSupportRequestStatus(status: string): status is SupportRequestStatusValue {
  return SUPPORT_REQUEST_STATUSES.has(status as SupportRequestStatusValue);
}

export function supportRequestStatusTransition(
  current: { status: SupportRequestStatusValue; closedAt: Date | null },
  requestedStatus: SupportRequestStatusValue,
  now = new Date(),
):
  | {
      ok: true;
      data: { status: SupportRequestStatusValue; closedAt: Date | null };
      metadata: {
        previousStatus: SupportRequestStatusValue;
        status: SupportRequestStatusValue;
        previousClosedAt: string | null;
        closedAt: string | null;
      };
    }
  | { ok: false; reason: "closed_terminal" } {
  if (current.status === "CLOSED" && requestedStatus !== "CLOSED") {
    return { ok: false, reason: "closed_terminal" };
  }

  const closedAt = requestedStatus === "CLOSED"
    ? current.closedAt ?? now
    : null;

  return {
    ok: true,
    data: { status: requestedStatus, closedAt },
    metadata: {
      previousStatus: current.status,
      status: requestedStatus,
      previousClosedAt: current.closedAt?.toISOString() ?? null,
      closedAt: closedAt?.toISOString() ?? null,
    },
  };
}

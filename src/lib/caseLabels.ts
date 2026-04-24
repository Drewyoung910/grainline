import type { CaseStatus } from "@prisma/client";

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  OPEN: "Open",
  IN_DISCUSSION: "In Discussion",
  PENDING_CLOSE: "Awaiting Resolution",
  UNDER_REVIEW: "Under Review",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export function caseStatusLabel(status: CaseStatus): string {
  return CASE_STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}


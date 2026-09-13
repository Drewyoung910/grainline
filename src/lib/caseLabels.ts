import type { CaseResolution, CaseStatus } from "@prisma/client";

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  OPEN: "Open",
  IN_DISCUSSION: "In Discussion",
  PENDING_CLOSE: "Awaiting Resolution",
  UNDER_REVIEW: "Under Review",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export const CASE_RESOLUTION_LABELS: Record<CaseResolution, string> = {
  REFUND_FULL: "Full refund",
  REFUND_PARTIAL: "Partial refund",
  DISMISSED: "Dismissed",
};

export function caseStatusLabel(status: CaseStatus): string {
  return CASE_STATUS_LABELS[status] ?? "Unknown";
}

export function caseResolutionLabel(resolution: CaseResolution): string {
  return CASE_RESOLUTION_LABELS[resolution] ?? "Unknown";
}

type CaseParticipantState = {
  id: string;
  banned?: boolean | null;
  deletedAt?: Date | string | null;
} | null;

export type UnavailableCaseRecipientReason = "suspended" | "deleted" | "missing";
export const CASE_MESSAGE_OPEN_STATUSES = [
  "OPEN",
  "IN_DISCUSSION",
  "PENDING_CLOSE",
  "UNDER_REVIEW",
] as const;

export function canCreateCaseMessageForStatus(status: string | null | undefined): boolean {
  return CASE_MESSAGE_OPEN_STATUSES.includes(status as (typeof CASE_MESSAGE_OPEN_STATUSES)[number]);
}

export function unavailableCaseMessageRecipientReason({
  senderId,
  buyer,
  seller,
  isStaff,
}: {
  senderId: string;
  buyer: CaseParticipantState;
  seller: CaseParticipantState;
  isStaff: boolean;
}): UnavailableCaseRecipientReason | null {
  if (isStaff) return null;

  const recipient = senderId === buyer?.id ? seller : senderId === seller?.id ? buyer : null;
  if (!recipient) return "missing";
  if (recipient.deletedAt) return "deleted";
  if (recipient.banned) return "suspended";
  return null;
}

export function unavailableCaseRecipientMessage(reason: UnavailableCaseRecipientReason) {
  if (reason === "suspended") {
    return "The other party's account is suspended. Escalate this case for staff review instead.";
  }
  if (reason === "deleted") {
    return "The other party's account has been deleted. Escalate this case for staff review instead.";
  }
  return "The other party is no longer available. Escalate this case for staff review instead.";
}

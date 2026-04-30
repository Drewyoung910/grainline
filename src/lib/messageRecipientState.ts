export type MessageRecipientState = {
  banned?: boolean | null;
  deletedAt?: Date | string | null;
} | null | undefined;

export function messagingUnavailableReason(recipient: MessageRecipientState) {
  if (!recipient || recipient.banned || recipient.deletedAt) {
    return "This account is no longer available. Messages are preserved, but new replies are disabled.";
  }

  return null;
}

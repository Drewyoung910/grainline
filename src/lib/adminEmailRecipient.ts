export function inactiveAdminEmailRecipientReason(
  account: { banned: boolean; deletedAt: Date | null } | null | undefined,
): string | null {
  if (!account) return null;
  if (account.deletedAt) return "Recipient account has been deleted";
  if (account.banned) return "Recipient account is banned";
  return null;
}

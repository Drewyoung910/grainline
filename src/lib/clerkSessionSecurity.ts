function normalizeSessionSecurityEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function shouldRevokeSessionsForClerkEmailChange({
  eventType,
  clerkUserId,
  previousEmail,
  nextEmail,
}: {
  eventType: string;
  clerkUserId: string;
  previousEmail: string | null | undefined;
  nextEmail: string | null | undefined;
}): boolean {
  if (eventType !== "user.updated") return false;

  const previous = normalizeSessionSecurityEmail(previousEmail);
  const next = normalizeSessionSecurityEmail(nextEmail);
  if (!previous || !next || previous === next) return false;

  const placeholder = `${clerkUserId}@placeholder.invalid`.toLowerCase();
  return previous !== placeholder;
}

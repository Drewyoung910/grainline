export function normalizeEmailAddress(email: string | null | undefined): string | null {
  const normalized = email?.trim().normalize("NFC").toLowerCase();
  if (!normalized || !normalized.includes("@")) return null;
  return normalized;
}

function gmailSuppressionAddress(email: string) {
  const [local, domain, ...rest] = email.split("@");
  if (!local || !domain || rest.length > 0) return email;

  const normalizedDomain = domain === "googlemail.com" ? "gmail.com" : domain;
  if (normalizedDomain !== "gmail.com") return email;

  const baseLocal = local.split("+")[0]?.replaceAll(".", "");
  if (!baseLocal) return email;
  return `${baseLocal}@gmail.com`;
}

export function normalizeEmailSuppressionAddress(email: string | null | undefined): string | null {
  const normalized = normalizeEmailAddress(email);
  return normalized ? gmailSuppressionAddress(normalized) : null;
}

export function emailSuppressionAddressKeys(email: string | null | undefined): string[] {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) return [];

  const suppression = normalizeEmailSuppressionAddress(normalized);
  return [...new Set([normalized, ...(suppression && suppression !== normalized ? [suppression] : [])])];
}

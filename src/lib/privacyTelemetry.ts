import { createHash } from "node:crypto";

export function hashIdentifierForTelemetry(value: string | null | undefined): string | null {
  const normalized = value?.trim().normalize("NFC");
  if (!normalized) return null;

  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return `sha256:${digest}`;
}

export function hashEmailForTelemetry(email: string | null | undefined): string | null {
  const normalized = email?.trim().normalize("NFC").toLowerCase();
  if (!normalized || !normalized.includes("@")) return null;

  return hashIdentifierForTelemetry(normalized);
}

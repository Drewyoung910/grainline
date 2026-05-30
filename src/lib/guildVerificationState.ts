import type { VerificationStatus } from "@prisma/client";

export const GUILD_MASTER_APPLICATION_VERIFICATION_STATUSES = [
  "APPROVED",
  "GUILD_MASTER_REJECTED",
] as const satisfies readonly VerificationStatus[];

export const GUILD_MEMBER_REVOKABLE_VERIFICATION_STATUSES = [
  "APPROVED",
  "GUILD_MASTER_REJECTED",
] as const satisfies readonly VerificationStatus[];

export const GUILD_MASTER_REVOKABLE_VERIFICATION_STATUSES = [
  "GUILD_MASTER_APPROVED",
] as const satisfies readonly VerificationStatus[];

export const GUILD_MEMBER_REINSTATABLE_VERIFICATION_STATUSES = [
  "REJECTED",
] as const satisfies readonly VerificationStatus[];

export class GuildVerificationTransitionConflictError extends Error {
  constructor(action: string) {
    super(`Guild verification transition changed while trying to ${action}.`);
    this.name = "GuildVerificationTransitionConflictError";
  }
}

export function assertGuildVerificationTransition(count: number, action: string) {
  if (count === 0) throw new GuildVerificationTransitionConflictError(action);
}

export function isGuildVerificationTransitionConflict(error: unknown) {
  return error instanceof GuildVerificationTransitionConflictError ||
    (error instanceof Error && error.name === "GuildVerificationTransitionConflictError");
}

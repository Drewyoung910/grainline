export const GUILD_REAPPLY_COOLDOWN_DAYS = 30;
export const GUILD_REAPPLY_COOLDOWN_MS = GUILD_REAPPLY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

type VerificationStatusLike = string | null | undefined;
type GuildLevelLike = string | null | undefined;

function cooldownAvailableAt(reviewedAt: Date | string | null | undefined): Date | null {
  if (!reviewedAt) return null;
  const reviewedTime = new Date(reviewedAt).getTime();
  if (!Number.isFinite(reviewedTime)) return null;
  return new Date(reviewedTime + GUILD_REAPPLY_COOLDOWN_MS);
}

function cooldownBlockReason({
  reviewedAt,
  now,
  label,
}: {
  reviewedAt: Date | string | null | undefined;
  now: Date;
  label: string;
}) {
  const availableAt = cooldownAvailableAt(reviewedAt);
  if (!availableAt || availableAt.getTime() <= now.getTime()) return null;
  return `${label} applications are paused until ${availableAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}.`;
}

export function guildMemberApplicationBlockReason({
  guildLevel,
  verificationStatus,
  reviewedAt,
  now = new Date(),
}: {
  guildLevel: GuildLevelLike;
  verificationStatus: VerificationStatusLike;
  reviewedAt?: Date | string | null;
  now?: Date;
}): string | null {
  if (guildLevel && guildLevel !== "NONE") return "Your Guild Member badge is already active.";
  if (verificationStatus === "PENDING") return "Your Guild Member application is already under review.";
  if (verificationStatus && verificationStatus !== "REJECTED") {
    return "Your current verification state cannot start a Guild Member application.";
  }
  if (verificationStatus === "REJECTED") {
    return cooldownBlockReason({ reviewedAt, now, label: "Guild Member" });
  }
  return null;
}

export function guildMasterApplicationBlockReason({
  guildLevel,
  verificationStatus,
  reviewedAt,
  now = new Date(),
}: {
  guildLevel: GuildLevelLike;
  verificationStatus: VerificationStatusLike;
  reviewedAt?: Date | string | null;
  now?: Date;
}): string | null {
  if (guildLevel !== "GUILD_MEMBER") return "Guild Master applications require an active Guild Member badge.";
  if (verificationStatus === "GUILD_MASTER_PENDING") return "Your Guild Master application is already under review.";
  if (verificationStatus === "GUILD_MASTER_APPROVED") return "Your Guild Master badge is already active.";
  if (verificationStatus === "GUILD_MASTER_REJECTED") {
    return cooldownBlockReason({ reviewedAt, now, label: "Guild Master" });
  }
  return null;
}

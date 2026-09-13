import { createHash } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { redis } from "@/lib/ratelimit";

export type AccountStateForMiddleware = {
  banned: boolean;
  deletedAt: Date | null;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  ageAttestedAt: Date | null;
};

type SerializedAccountState =
  | { exists: false }
  | {
      exists: true;
      banned: boolean;
      deletedAt: string | null;
      termsAcceptedAt: string | null;
      termsVersion: string | null;
      ageAttestedAt: string | null;
    };

const ACCOUNT_STATE_CACHE_TTL_SECONDS = 60;

function accountStateCacheNamespace(env: NodeJS.ProcessEnv = process.env) {
  if (env.VERCEL_ENV === "production") return "vercel-production";
  if (env.VERCEL_ENV === "preview") {
    const previewIdentity = env.VERCEL_GIT_COMMIT_REF || env.VERCEL_URL || "unknown-preview";
    const digest = createHash("sha256").update(previewIdentity).digest("hex").slice(0, 16);
    return `vercel-preview-${digest}`;
  }
  if (env.VERCEL_ENV === "development" || env.NODE_ENV === "development") {
    return "development";
  }
  if (env.NODE_ENV === "test") return "test";
  return "self-hosted-production";
}

function accountStateCacheKey(clerkId: string) {
  return `account-state:${accountStateCacheNamespace()}:clerk:${clerkId}`;
}

function serializeAccountState(account: AccountStateForMiddleware | null): SerializedAccountState {
  if (!account) return { exists: false };
  return {
    exists: true,
    banned: account.banned,
    deletedAt: account.deletedAt?.toISOString() ?? null,
    termsAcceptedAt: account.termsAcceptedAt?.toISOString() ?? null,
    termsVersion: account.termsVersion,
    ageAttestedAt: account.ageAttestedAt?.toISOString() ?? null,
  };
}

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function deserializeAccountState(value: unknown): AccountStateForMiddleware | null | undefined {
  if (value === null) return undefined;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<SerializedAccountState>;
  if (record.exists === false) return null;
  if (record.exists !== true) return undefined;
  if (typeof record.banned !== "boolean") return undefined;
  return {
    banned: record.banned,
    deletedAt: parseDate(record.deletedAt ?? null),
    termsAcceptedAt: parseDate(record.termsAcceptedAt ?? null),
    termsVersion: typeof record.termsVersion === "string" ? record.termsVersion : null,
    ageAttestedAt: parseDate(record.ageAttestedAt ?? null),
  };
}

export async function getCachedAccountStateForMiddleware(
  clerkId: string,
  loadAccount: () => Promise<AccountStateForMiddleware | null>,
): Promise<AccountStateForMiddleware | null> {
  const key = accountStateCacheKey(clerkId);

  try {
    const cached = deserializeAccountState(await redis.get<SerializedAccountState | null>(key));
    if (cached !== undefined) return cached;
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "account_state_cache_read" },
      extra: { clerkId },
    });
  }

  const account = await loadAccount();

  try {
    await redis.set(key, serializeAccountState(account), { ex: ACCOUNT_STATE_CACHE_TTL_SECONDS });
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "account_state_cache_write" },
      extra: { clerkId },
    });
  }

  return account;
}

export async function invalidateAccountStateCache(clerkId: string | null | undefined, source: string) {
  if (!clerkId) return;
  try {
    await redis.del(accountStateCacheKey(clerkId));
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source },
      extra: { clerkId },
    });
  }
}

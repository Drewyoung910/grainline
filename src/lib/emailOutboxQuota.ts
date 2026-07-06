export const DEFAULT_EMAIL_OUTBOX_DAILY_SEND_LIMIT = 3000;
export const DEFAULT_EMAIL_OUTBOX_DAILY_RECIPIENT_SEND_LIMIT = 20;

export const EMAIL_OUTBOX_DAILY_ALLOWANCE_SCRIPT = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local requested = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

if requested <= 0 or limit <= 0 then
  return 0
end

if current >= limit then
  if redis.call("TTL", KEYS[1]) < 0 then
    redis.call("EXPIRE", KEYS[1], ttl)
  end
  return 0
end

local allowed = math.min(requested, limit - current)
redis.call("INCRBY", KEYS[1], allowed)

if redis.call("TTL", KEYS[1]) < 0 then
  redis.call("EXPIRE", KEYS[1], ttl)
end

return allowed
`;

export const EMAIL_OUTBOX_DAILY_ALLOWANCE_ROLLBACK_SCRIPT = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local requested = tonumber(ARGV[1])

if requested <= 0 or current <= 0 then
  return current
end

local rollback = math.min(requested, current)
local next = current - rollback

if next <= 0 then
  redis.call("DEL", KEYS[1])
  return 0
end

redis.call("DECRBY", KEYS[1], rollback)
return next
`;

export type EmailOutboxQuotaCounter = (args: {
  key: string;
  requested: number;
  limit: number;
  ttlSeconds: number;
}) => Promise<number>;

export type EmailOutboxQuotaRollbackCounter = (args: {
  key: string;
  requested: number;
}) => Promise<number>;

export type EmailOutboxDailyAllowance = {
  allowed: number;
  limit: number;
  resetAt: Date;
  counterAvailable: boolean;
};

export function configuredEmailOutboxDailySendLimit(value = process.env.EMAIL_OUTBOX_DAILY_LIMIT) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_EMAIL_OUTBOX_DAILY_SEND_LIMIT;
}

export function configuredEmailOutboxDailyRecipientSendLimit(
  value = process.env.EMAIL_OUTBOX_DAILY_RECIPIENT_LIMIT,
) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_EMAIL_OUTBOX_DAILY_RECIPIENT_SEND_LIMIT;
}

export function nextUtcMidnight(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

export function emailOutboxDailyQuotaKey(date: Date) {
  return `email-outbox:sent:${date.toISOString().slice(0, 10)}`;
}

export function emailOutboxRecipientDailyQuotaKey(recipientHash: string, date: Date) {
  const safeHash = recipientHash.replace(/[^a-zA-Z0-9:._-]/g, "_");
  return `email-outbox:sent:${date.toISOString().slice(0, 10)}:recipient:${safeHash}`;
}

export function emailOutboxDailyQuotaTtlSeconds(now: Date, resetAt = nextUtcMidnight(now)) {
  return Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000) + 3600);
}

export async function reserveEmailOutboxDailySendAllowance({
  requested,
  now,
  counter,
  limit = configuredEmailOutboxDailySendLimit(),
  onCounterError,
}: {
  requested: number;
  now: Date;
  counter: EmailOutboxQuotaCounter;
  limit?: number;
  onCounterError?: (error: unknown) => void;
}): Promise<EmailOutboxDailyAllowance> {
  const resetAt = nextUtcMidnight(now);
  const normalizedRequested = Math.max(0, Math.floor(requested));
  if (normalizedRequested === 0) return { allowed: 0, limit, resetAt, counterAvailable: true };

  try {
    const reserved = await counter({
      key: emailOutboxDailyQuotaKey(now),
      requested: normalizedRequested,
      limit,
      ttlSeconds: emailOutboxDailyQuotaTtlSeconds(now, resetAt),
    });
    const allowed = Math.max(0, Math.min(normalizedRequested, Math.floor(Number(reserved) || 0)));
    return { allowed, limit, resetAt, counterAvailable: true };
  } catch (error) {
    onCounterError?.(error);
    return { allowed: 0, limit, resetAt, counterAvailable: false };
  }
}

export async function reserveEmailOutboxRecipientDailySendAllowance({
  recipientHash,
  requested,
  now,
  counter,
  limit = configuredEmailOutboxDailyRecipientSendLimit(),
  onCounterError,
}: {
  recipientHash: string;
  requested: number;
  now: Date;
  counter: EmailOutboxQuotaCounter;
  limit?: number;
  onCounterError?: (error: unknown) => void;
}): Promise<EmailOutboxDailyAllowance> {
  const resetAt = nextUtcMidnight(now);
  const normalizedRequested = Math.max(0, Math.floor(requested));
  if (normalizedRequested === 0) return { allowed: 0, limit, resetAt, counterAvailable: true };

  try {
    const reserved = await counter({
      key: emailOutboxRecipientDailyQuotaKey(recipientHash, now),
      requested: normalizedRequested,
      limit,
      ttlSeconds: emailOutboxDailyQuotaTtlSeconds(now, resetAt),
    });
    const allowed = Math.max(0, Math.min(normalizedRequested, Math.floor(Number(reserved) || 0)));
    return { allowed, limit, resetAt, counterAvailable: true };
  } catch (error) {
    onCounterError?.(error);
    return { allowed: 0, limit, resetAt, counterAvailable: false };
  }
}

export async function rollbackEmailOutboxRecipientDailySendAllowance({
  recipientHash,
  requested,
  now,
  counter,
  onCounterError,
}: {
  recipientHash: string;
  requested: number;
  now: Date;
  counter: EmailOutboxQuotaRollbackCounter;
  onCounterError?: (error: unknown) => void;
}): Promise<{ rolledBack: boolean; counterAvailable: boolean }> {
  const normalizedRequested = Math.max(0, Math.floor(requested));
  if (normalizedRequested === 0) return { rolledBack: false, counterAvailable: true };

  try {
    await counter({
      key: emailOutboxRecipientDailyQuotaKey(recipientHash, now),
      requested: normalizedRequested,
    });
    return { rolledBack: true, counterAvailable: true };
  } catch (error) {
    onCounterError?.(error);
    return { rolledBack: false, counterAvailable: false };
  }
}

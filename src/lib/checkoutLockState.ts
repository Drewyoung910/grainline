export const CHECKOUT_LOCK_TTL_SECONDS = 32 * 60;

export type CheckoutLock = {
  state: "preparing" | "ready";
  payloadHash: string;
  ownerToken?: string;
  createdAt: number;
  sessionId?: string;
  clientSecret?: string | null;
};

export const MARK_CHECKOUT_LOCK_READY_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return 0
end

local ok, current = pcall(cjson.decode, raw)
if not ok then
  return 0
end

if current["state"] ~= "preparing"
   or current["payloadHash"] ~= ARGV[1]
   or current["ownerToken"] ~= ARGV[2] then
  return 0
end

redis.call("SET", KEYS[1], ARGV[3], "EX", ARGV[4])
return 1
`;

export const RELEASE_CHECKOUT_LOCK_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return 0
end

local ok, current = pcall(cjson.decode, raw)
if not ok then
  return 0
end

if current["sessionId"] == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end

return 0
`;

export const RELEASE_PREPARING_CHECKOUT_LOCK_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return 0
end

local ok, current = pcall(cjson.decode, raw)
if not ok then
  return 0
end

if current["state"] == "preparing" and current["ownerToken"] == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end

return 0
`;

export function checkoutLockCanMarkReady(
  lock: CheckoutLock | null,
  payloadHash: string,
  ownerToken: string,
) {
  return lock?.state === "preparing"
    && lock.payloadHash === payloadHash
    && lock.ownerToken === ownerToken;
}

export function checkoutLockCanRelease(lock: CheckoutLock | null, expectedSessionId: string) {
  return lock?.sessionId === expectedSessionId;
}

export function checkoutLockCanReleasePreparing(lock: CheckoutLock | null, ownerToken: string) {
  return lock?.state === "preparing" && lock.ownerToken === ownerToken;
}

export function checkoutSessionCreateIdempotencyKey(ownerToken: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerToken)) {
    throw new Error("Checkout session idempotency owner token is invalid");
  }
  return `grainline-checkout-session-v1:${ownerToken}`;
}

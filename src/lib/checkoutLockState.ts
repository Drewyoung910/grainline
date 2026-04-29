export const CHECKOUT_LOCK_TTL_SECONDS = 32 * 60;

export type CheckoutLock = {
  state: "preparing" | "ready";
  payloadHash: string;
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

if current["state"] ~= "preparing" or current["payloadHash"] ~= ARGV[1] then
  return 0
end

redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
return 1
`;

export const RELEASE_CHECKOUT_LOCK_SCRIPT = `
if ARGV[1] == "" then
  return redis.call("DEL", KEYS[1])
end

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

export function checkoutLockCanMarkReady(lock: CheckoutLock | null, payloadHash: string) {
  return lock?.state === "preparing" && lock.payloadHash === payloadHash;
}

export function checkoutLockCanRelease(lock: CheckoutLock | null, expectedSessionId?: string | null) {
  if (!expectedSessionId) return true;
  return lock?.sessionId === expectedSessionId;
}

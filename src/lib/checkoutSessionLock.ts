import { createHash, randomUUID } from "crypto";
import * as Sentry from "@sentry/nextjs";
import { redis } from "@/lib/ratelimit";
import {
  CHECKOUT_LOCK_TTL_SECONDS,
  MARK_CHECKOUT_LOCK_READY_SCRIPT,
  RELEASE_PREPARING_CHECKOUT_LOCK_SCRIPT,
  RELEASE_CHECKOUT_LOCK_SCRIPT,
  checkoutSessionCreateIdempotencyKey,
  type CheckoutLock,
} from "@/lib/checkoutLockState";

export { checkoutSessionCreateIdempotencyKey };

const markCheckoutLockReadyScript = redis.createScript<number>(MARK_CHECKOUT_LOCK_READY_SCRIPT);
const releaseCheckoutLockScript = redis.createScript<number>(RELEASE_CHECKOUT_LOCK_SCRIPT);
const releasePreparingCheckoutLockScript = redis.createScript<number>(RELEASE_PREPARING_CHECKOUT_LOCK_SCRIPT);

export function cartCheckoutLockKey(cartId: string, sellerId: string): string {
  return `checkout:cart:${cartId}:seller:${sellerId}`;
}

export function singleCheckoutLockKey(userId: string, listingId: string): string {
  return `checkout:single:${userId}:listing:${listingId}`;
}

export function checkoutPayloadHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("base64url")
    .slice(0, 32);
}

export async function getCheckoutLock(key: string): Promise<CheckoutLock | null> {
  const raw = await redis.get<string | CheckoutLock>(key);
  if (!raw) return null;
  if (typeof raw === "object") return raw as CheckoutLock;
  try {
    return JSON.parse(raw) as CheckoutLock;
  } catch {
    return null;
  }
}

export async function acquireCheckoutLock(key: string, payloadHash: string): Promise<string | null> {
  const ownerToken = randomUUID();
  const lock: CheckoutLock = {
    state: "preparing",
    payloadHash,
    ownerToken,
    createdAt: Date.now(),
  };
  const result = await redis.set(key, JSON.stringify(lock), {
    nx: true,
    ex: CHECKOUT_LOCK_TTL_SECONDS,
  });
  return result === "OK" ? ownerToken : null;
}

export async function markCheckoutLockReady(
  key: string,
  payloadHash: string,
  ownerToken: string,
  sessionId: string,
  clientSecret: string | null,
): Promise<boolean> {
  const lock: CheckoutLock = {
    state: "ready",
    payloadHash,
    ownerToken,
    createdAt: Date.now(),
    sessionId,
    clientSecret,
  };
  const result = await markCheckoutLockReadyScript.eval(
    [key],
    [payloadHash, ownerToken, JSON.stringify(lock), String(CHECKOUT_LOCK_TTL_SECONDS)],
  );
  return result === 1;
}

export async function releaseCheckoutLock(key: string | null | undefined, expectedSessionId: string): Promise<boolean> {
  if (!key) return false;
  try {
    const result = await releaseCheckoutLockScript.eval([key], [expectedSessionId]);
    return result === 1;
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "checkout_lock_release" } });
    return false;
  }
}

export async function releasePreparingCheckoutLock(
  key: string | null | undefined,
  ownerToken: string,
): Promise<boolean> {
  if (!key) return false;
  try {
    const result = await releasePreparingCheckoutLockScript.eval([key], [ownerToken]);
    return result === 1;
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "checkout_preparing_lock_release" } });
    return false;
  }
}

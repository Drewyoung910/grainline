import { createHash } from "crypto";
import * as Sentry from "@sentry/nextjs";
import { redis } from "@/lib/ratelimit";

const CHECKOUT_LOCK_TTL_SECONDS = 32 * 60;

export type CheckoutLock = {
  state: "preparing" | "ready";
  payloadHash: string;
  createdAt: number;
  sessionId?: string;
  clientSecret?: string | null;
};

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

export async function acquireCheckoutLock(key: string, payloadHash: string): Promise<boolean> {
  const lock: CheckoutLock = {
    state: "preparing",
    payloadHash,
    createdAt: Date.now(),
  };
  const result = await redis.set(key, JSON.stringify(lock), {
    nx: true,
    ex: CHECKOUT_LOCK_TTL_SECONDS,
  });
  return result === "OK";
}

export async function markCheckoutLockReady(
  key: string,
  payloadHash: string,
  sessionId: string,
  clientSecret: string | null,
): Promise<void> {
  const lock: CheckoutLock = {
    state: "ready",
    payloadHash,
    createdAt: Date.now(),
    sessionId,
    clientSecret,
  };
  await redis.set(key, JSON.stringify(lock), { ex: CHECKOUT_LOCK_TTL_SECONDS });
}

export async function releaseCheckoutLock(key?: string | null): Promise<void> {
  if (!key) return;
  try {
    await redis.del(key);
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "checkout_lock_release" } });
  }
}


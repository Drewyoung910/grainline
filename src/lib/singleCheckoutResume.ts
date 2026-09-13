import { sellerOrderBlockReason, type SellerOrderState } from "./sellerOrderState.ts";

type ReadyCheckoutLock = {
  state?: unknown;
  payloadHash?: unknown;
  sessionId?: unknown;
  clientSecret?: unknown;
};

type CheckoutSession = {
  id?: unknown;
  status?: unknown;
  payment_status?: unknown;
  mode?: unknown;
  ui_mode?: unknown;
  client_secret?: unknown;
  metadata?: Record<string, string> | null;
};

export type SingleCheckoutResumeResult =
  | { clientSecret: string; sessionId: string; completedSessionId: null }
  | { clientSecret: null; sessionId: null; completedSessionId: string };

const CHECKOUT_PAYLOAD_HASH_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const CHECKOUT_SESSION_ID_PATTERN = /^cs_(?:test|live)_[A-Za-z0-9_]+$/;

type SingleCheckoutResumeSource = {
  status: unknown;
  isPrivate: unknown;
  reservedForUserId: unknown;
  seller: (SellerOrderState & {
    id?: unknown;
    userId?: unknown;
    stripeAccountId?: unknown;
    chargesEnabled?: unknown;
  }) | null;
};

export function singleCheckoutResumeSourceIsAvailable(
  listing: SingleCheckoutResumeSource | null,
  buyerId: string,
): boolean {
  const seller = listing?.seller;
  const sellerUser = seller?.user;
  return Boolean(listing
    && seller
    && buyerId.length > 0
    && listing.status === "ACTIVE"
    && typeof listing.isPrivate === "boolean"
    && (!listing.isPrivate || listing.reservedForUserId === buyerId)
    && typeof seller.id === "string"
    && seller.id.length > 0
    && typeof seller.userId === "string"
    && seller.userId.length > 0
    && seller.userId !== buyerId
    && typeof seller.stripeAccountId === "string"
    && seller.stripeAccountId.length > 0
    && seller.chargesEnabled === true
    && seller.vacationMode === false
    && seller.acceptingNewOrders === true
    && (seller.stripeAccountVersion === null || seller.stripeAccountVersion === "v2")
    && sellerUser?.banned === false
    && sellerUser.deletedAt === null
    && !sellerOrderBlockReason(seller));
}

function clientSecretMatchesSession(sessionId: string, clientSecret: unknown): clientSecret is string {
  if (typeof clientSecret !== "string" || clientSecret.length > 1024) return false;
  const prefix = `${sessionId}_secret_`;
  if (!clientSecret.startsWith(prefix)) return false;
  const suffix = clientSecret.slice(prefix.length);
  return suffix.length > 0 && /^(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})+$/.test(suffix);
}

export function resolveSingleCheckoutResume(
  lock: ReadyCheckoutLock | null,
  session: CheckoutSession | null,
  expected: { buyerId: string; listingId: string; sellerId: string; checkoutLockKey: string },
): SingleCheckoutResumeResult | null {
  if (!lock || lock.state !== "ready"
    || typeof lock.payloadHash !== "string" || !CHECKOUT_PAYLOAD_HASH_PATTERN.test(lock.payloadHash)
    || typeof lock.sessionId !== "string" || !CHECKOUT_SESSION_ID_PATTERN.test(lock.sessionId)
    || !clientSecretMatchesSession(lock.sessionId, lock.clientSecret)
    || !session || session.id !== lock.sessionId
    || session.mode !== "payment" || session.ui_mode !== "embedded") {
    return null;
  }

  const metadata = session.metadata;
  if (!metadata
    || metadata.buyerId !== expected.buyerId
    || metadata.listingId !== expected.listingId
    || metadata.sellerId !== expected.sellerId
    || metadata.checkoutLockKey !== expected.checkoutLockKey
    || metadata.checkoutPayloadHash !== lock.payloadHash) {
    return null;
  }

  if (session.payment_status === "paid" || session.status === "complete") {
    return { clientSecret: null, sessionId: null, completedSessionId: lock.sessionId };
  }

  if (session.status !== "open" || session.payment_status !== "unpaid"
    || !clientSecretMatchesSession(lock.sessionId, session.client_secret)
    || session.client_secret !== lock.clientSecret) {
    return null;
  }

  return {
    clientSecret: session.client_secret,
    sessionId: lock.sessionId,
    completedSessionId: null,
  };
}

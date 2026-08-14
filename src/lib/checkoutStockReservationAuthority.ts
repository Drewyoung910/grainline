import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type AuthorityClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type CheckoutReservationItem = Readonly<{
  listingId: string;
  sellerId: string;
  quantity: number;
}>;

export type CheckoutReservationCreation = Readonly<{
  id: string;
  reservedItems: CheckoutReservationItem[];
  expiresAt: Date;
}>;

export type CheckoutReservationTransition = Readonly<{
  result: "absent" | "retained" | "terminal" | "completed" | "restored";
  checkoutLockKey: string | null;
  stockVisibilityChanged: number;
}>;

export type CheckoutReservationRepairClaim = Readonly<{
  reservationId: string;
  repairGeneration: bigint;
  stripeSessionId: string | null;
}>;

export type CheckoutReservationRepairResult = Readonly<{
  result: "absent" | "superseded" | "terminal" | "completed" | "deferred" | "restored";
  checkoutLockKey: string | null;
  stripeSessionId: string | null;
  stockVisibilityChanged: number;
}>;

export type CheckoutReservationResumeRow = Readonly<{
  stripeSessionId: string;
  checkoutGroupId: string;
  createdAt: Date;
}>;

export type CheckoutReservationExportRow = Readonly<{
  id: string;
  exportedAsBuyer: boolean;
  exportedAsSeller: boolean;
  buyerId: string | null;
  sellerId: string | null;
  stripeSessionId: string | null;
  status: string;
  reservedItems: Array<{ listingId: string; quantity: number }>;
  expiresAt: Date;
  restoredAt: Date | null;
  restoreReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

function exactString(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Checkout reservation authority returned an invalid ${label}`);
  }
  return value;
}

function nullableString(value: unknown, label: string) {
  return value === null ? null : exactString(value, label);
}

function exactBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new Error(`Checkout reservation authority returned an invalid ${label}`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, label: string) {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Checkout reservation authority returned an invalid ${label}`);
  }
  return parsed;
}

function positiveBigInt(value: unknown, label: string) {
  let parsed: bigint;
  if (typeof value === "bigint") parsed = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) parsed = BigInt(value);
  else if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) parsed = BigInt(value);
  else throw new Error(`Checkout reservation authority returned an invalid ${label}`);
  if (parsed < 1n) throw new Error(`Checkout reservation authority returned an invalid ${label}`);
  return parsed;
}

function exactDate(value: unknown, label: string) {
  const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error(`Checkout reservation authority returned an invalid ${label}`);
  }
  return parsed;
}

function nullableDate(value: unknown, label: string) {
  return value === null ? null : exactDate(value, label);
}

function creationItems(value: unknown): CheckoutReservationItem[] {
  if (!Array.isArray(value)) {
    throw new Error("Checkout reservation authority returned invalid reserved items");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Checkout reservation authority returned an invalid reserved item");
    }
    const row = item as Record<string, unknown>;
    const quantity = nonnegativeInteger(row.quantity, "reserved quantity");
    if (quantity < 1) throw new Error("Checkout reservation authority returned an invalid reserved quantity");
    return Object.freeze({
      listingId: exactString(row.listingId, "reserved listing id"),
      sellerId: exactString(row.sellerId, "reserved seller id"),
      quantity,
    });
  });
}

function exportItems(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Checkout reservation export returned invalid reserved items");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Checkout reservation export returned an invalid reserved item");
    }
    const row = item as Record<string, unknown>;
    const quantity = nonnegativeInteger(row.quantity, "export quantity");
    if (quantity < 1) throw new Error("Checkout reservation export returned an invalid quantity");
    return {
      listingId: exactString(row.listingId, "export listing id"),
      quantity,
    };
  });
}

function oneRow<T>(rows: readonly T[], label: string) {
  if (rows.length !== 1) throw new Error(`Checkout reservation ${label} returned an invalid row count`);
  return rows[0];
}

function parseCreation(rows: readonly Record<string, unknown>[]) {
  if (rows.length === 0) return null;
  const row = oneRow(rows, "creation");
  return Object.freeze({
    id: exactString(row.reservation_id, "reservation id"),
    reservedItems: creationItems(row.reserved_items),
    expiresAt: exactDate(row.expires_at, "expiry"),
  });
}

export async function createCartCheckoutStockReservation(input: {
  buyerId: string;
  cartId: string;
  sellerProfileId: string;
  checkoutGroupId?: string | null;
  payloadHash: string;
}, client: AuthorityClient = prisma) {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT reservation_id, reserved_items, expires_at
      FROM public.grainline_checkout_reservation_create_cart(
        ${input.buyerId},
        ${input.cartId},
        ${input.sellerProfileId},
        ${input.checkoutGroupId ?? null},
        ${input.payloadHash}
      )
  `;
  return parseCreation(rows);
}

export async function createSingleCheckoutStockReservation(input: {
  buyerId: string;
  listingId: string;
  quantity: number;
  payloadHash: string;
}, client: AuthorityClient = prisma) {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT reservation_id, reserved_items, expires_at
      FROM public.grainline_checkout_reservation_create_single(
        ${input.buyerId},
        ${input.listingId},
        ${input.quantity},
        ${input.payloadHash}
      )
  `;
  return parseCreation(rows);
}

export async function createConsistentCartCheckoutStockReservation(input: {
  buyerId: string;
  cartId: string;
  sellerProfileId: string;
  checkoutGroupId?: string | null;
  payloadHash: string;
  sourceWitness: string;
}, client: AuthorityClient = prisma) {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT reservation_id, reserved_items, expires_at
      FROM public.grainline_checkout_reservation_create_cart_consistent(
        ${input.buyerId},
        ${input.cartId},
        ${input.sellerProfileId},
        ${input.checkoutGroupId ?? null},
        ${input.payloadHash},
        ${input.sourceWitness}::jsonb
      )
  `;
  return parseCreation(rows);
}

export async function createConsistentSingleCheckoutStockReservation(input: {
  buyerId: string;
  listingId: string;
  quantity: number;
  selectedVariantOptionIds: readonly string[];
  payloadHash: string;
  sourceWitness: string;
}, client: AuthorityClient = prisma) {
  const selectedVariantOptionIds = input.selectedVariantOptionIds.length > 0
    ? Prisma.sql`ARRAY[${Prisma.join(input.selectedVariantOptionIds)}]::text[]`
    : Prisma.sql`ARRAY[]::text[]`;
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT reservation_id, reserved_items, expires_at
      FROM public.grainline_checkout_reservation_create_single_consistent(
        ${input.buyerId},
        ${input.listingId},
        ${input.quantity},
        ${selectedVariantOptionIds},
        ${input.payloadHash},
        ${input.sourceWitness}::jsonb
      )
  `;
  return parseCreation(rows);
}

export async function bindCheckoutStockReservationSession(input: {
  reservationId?: string | null;
  buyerId: string;
  payloadHash: string;
  sessionId: string;
}, client: AuthorityClient = prisma) {
  if (!input.reservationId) return false;
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_checkout_reservation_bind_session(
      ${input.reservationId},
      ${input.buyerId},
      ${input.payloadHash},
      ${input.sessionId}
    ) AS result
  `;
  const result = oneRow(rows, "session bind").result;
  if (typeof result !== "boolean") throw new Error("Checkout reservation bind returned an invalid result");
  return result;
}

export async function completeCheckoutStockReservation(
  client: AuthorityClient,
  input: {
    eventId: string;
    claimGeneration: bigint;
    reservationId?: string | null;
    sessionId: string;
  },
) {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_checkout_reservation_complete(
      ${input.eventId},
      ${input.claimGeneration},
      ${input.reservationId ?? null},
      ${input.sessionId}
    ) AS result
  `;
  const result = oneRow(rows, "completion").result;
  if (result !== "absent" && result !== "completed" && result !== "already_completed") {
    throw new Error("Checkout reservation completion returned an invalid result");
  }
  return result;
}

function parseTransition(rows: readonly Record<string, unknown>[]): CheckoutReservationTransition {
  const row = oneRow(rows, "transition");
  const result = row.result;
  if (result !== "absent" && result !== "retained" && result !== "terminal" && result !== "completed" && result !== "restored") {
    throw new Error("Checkout reservation transition returned an invalid result");
  }
  return Object.freeze({
    result,
    checkoutLockKey: nullableString(row.checkout_lock_key, "checkout lock key"),
    stockVisibilityChanged: nonnegativeInteger(row.stock_visibility_changed, "stock visibility count"),
  });
}

export async function abortCheckoutStockReservation(input: {
  reservationId?: string | null;
  buyerId: string;
  payloadHash: string;
}) {
  if (!input.reservationId) {
    return Object.freeze({ result: "absent", checkoutLockKey: null, stockVisibilityChanged: 0 }) satisfies CheckoutReservationTransition;
  }
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT result, checkout_lock_key, stock_visibility_changed
      FROM public.grainline_checkout_reservation_checkout_abort(
        ${input.reservationId},
        ${input.buyerId},
        ${input.payloadHash}
      )
  `;
  return parseTransition(rows);
}

export async function restoreCheckoutStockReservationFromWebhook(input: {
  eventId: string;
  claimGeneration: bigint;
  sessionId: string;
}) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT result, checkout_lock_key, stock_visibility_changed
      FROM public.grainline_checkout_reservation_webhook_restore(
        ${input.eventId},
        ${input.claimGeneration},
        ${input.sessionId}
      )
  `;
  return parseTransition(rows);
}

export async function restoreBuyerExpiredCheckoutStockReservation(input: {
  buyerId: string;
  sessionId: string;
}) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT result, checkout_lock_key, stock_visibility_changed
      FROM public.grainline_checkout_reservation_buyer_expired_restore(
        ${input.buyerId},
        ${input.sessionId}
      )
  `;
  return parseTransition(rows);
}

export async function restoreSellerExpiredCheckoutStockReservation(input: {
  sellerProfileId: string;
  sessionId: string;
}) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT result, checkout_lock_key, stock_visibility_changed
      FROM public.grainline_checkout_reservation_seller_expired_restore(
        ${input.sellerProfileId},
        ${input.sessionId}
      )
  `;
  return parseTransition(rows);
}

function parseRepairClaims(rows: readonly Record<string, unknown>[]) {
  return rows.map((row) => Object.freeze({
    reservationId: exactString(row.reservation_id, "repair reservation id"),
    repairGeneration: positiveBigInt(row.repair_generation, "repair generation"),
    stripeSessionId: nullableString(row.stripe_session_id, "repair session id"),
  }));
}

export async function claimStaleCheckoutStockReservations(limit: number) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT reservation_id, repair_generation, stripe_session_id
      FROM public.grainline_checkout_reservation_repair_claim_batch(${limit})
  `;
  return parseRepairClaims(rows);
}

export async function claimAccountCheckoutStockReservations(
  client: AuthorityClient,
  userId: string,
  limit: number,
) {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT reservation_id, repair_generation, stripe_session_id
      FROM public.grainline_checkout_reservation_account_claim_batch(${userId}, ${limit})
  `;
  return parseRepairClaims(rows);
}

export type CheckoutReservationRepairOutcome =
  | "NO_SESSION_RESTORE"
  | "SESSION_EXPIRED_RESTORE"
  | "PAID_OR_COMPLETE"
  | "RETRIEVE_FAILED"
  | "UNRECOGNIZED"
  | "EXPIRE_FAILED";

export async function finalizeCheckoutStockReservationRepair(input: {
  reservationId: string;
  repairGeneration: bigint;
  outcome: CheckoutReservationRepairOutcome;
}) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT result, checkout_lock_key, stripe_session_id, stock_visibility_changed
      FROM public.grainline_checkout_reservation_repair_finalize(
        ${input.reservationId},
        ${input.repairGeneration},
        ${input.outcome}
      )
  `;
  const row = oneRow(rows, "repair finalizer");
  const result = row.result;
  if (result !== "absent" && result !== "superseded" && result !== "terminal" && result !== "completed" && result !== "deferred" && result !== "restored") {
    throw new Error("Checkout reservation repair finalizer returned an invalid result");
  }
  return Object.freeze({
    result,
    checkoutLockKey: nullableString(row.checkout_lock_key, "repair checkout lock key"),
    stripeSessionId: nullableString(row.stripe_session_id, "repair Stripe session id"),
    stockVisibilityChanged: nonnegativeInteger(row.stock_visibility_changed, "repair stock visibility count"),
  }) satisfies CheckoutReservationRepairResult;
}

export async function pruneCheckoutStockReservationBatch(limit: number) {
  const rows = await prisma.$queryRaw<Array<{ pruned: unknown }>>`
    SELECT public.grainline_checkout_reservation_prune_batch(${limit}) AS pruned
  `;
  return nonnegativeInteger(oneRow(rows, "prune").pruned, "prune count");
}

export async function resumeCheckoutStockReservations(input: {
  buyerId: string;
  checkoutGroupId?: string | null;
}) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT stripe_session_id, checkout_group_id, created_at
      FROM public.grainline_checkout_reservation_resume(
        ${input.buyerId},
        ${input.checkoutGroupId ?? null}
      )
  `;
  return rows.map((row) => Object.freeze({
    stripeSessionId: exactString(row.stripe_session_id, "resume session id"),
    checkoutGroupId: exactString(row.checkout_group_id, "resume group id"),
    createdAt: exactDate(row.created_at, "resume creation time"),
  })) satisfies CheckoutReservationResumeRow[];
}

export async function exportCheckoutStockReservations(userId: string) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM public.grainline_checkout_reservation_export(${userId})
  `;
  return rows.map((row) => Object.freeze({
    id: exactString(row.id, "export id"),
    exportedAsBuyer: exactBoolean(row.exported_as_buyer, "buyer export flag"),
    exportedAsSeller: exactBoolean(row.exported_as_seller, "seller export flag"),
    buyerId: nullableString(row.buyer_id, "export buyer id"),
    sellerId: nullableString(row.seller_id, "export seller id"),
    stripeSessionId: nullableString(row.stripe_session_id, "export session id"),
    status: exactString(row.status, "export status"),
    reservedItems: exportItems(row.reserved_items),
    expiresAt: exactDate(row.expires_at, "export expiry"),
    restoredAt: nullableDate(row.restored_at, "export restoration time"),
    restoreReason: nullableString(row.restore_reason, "export restoration reason"),
    createdAt: exactDate(row.created_at, "export creation time"),
    updatedAt: exactDate(row.updated_at, "export update time"),
  })) satisfies CheckoutReservationExportRow[];
}

export async function scrubCheckoutStockReservationsForAccount(
  client: AuthorityClient,
  userId: string,
) {
  const rows = await client.$queryRaw<Array<{ scrubbed: unknown }>>`
    SELECT public.grainline_checkout_reservation_account_scrub(${userId}) AS scrubbed
  `;
  return nonnegativeInteger(oneRow(rows, "account scrub").scrubbed, "account scrub count");
}

export function isCheckoutStockUnavailableDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Checkout stock is unavailable");
}

export function isCheckoutReservationSourceChangedDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Checkout source witness changed");
}

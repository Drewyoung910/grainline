import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";

type OrderFulfillmentClient = Pick<typeof prisma, "$queryRaw">;

const ORDER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;
const AUDIT_ID_MAX_LENGTH = 255;

export type OrderFulfillmentConflictReason =
  | "unpaid"
  | "refunded"
  | "open_dispute"
  | "active_case"
  | "seller_deauthorized"
  | "state_changed"
  | "method_mismatch"
  | "label_purchased"
  | "buyer_data_purged";

export type SellerFulfillmentAction = "shipped" | "ready_for_pickup";

export type SellerFulfillmentAuthorityResult =
  | { outcome: "unauthorized" }
  | { outcome: "conflict"; reason: OrderFulfillmentConflictReason }
  | {
      outcome: "changed";
      orderId: string;
      buyerUserId: string | null;
      buyerName: string | null;
      buyerEmail: string | null;
      sellerDisplayName: string | null;
      estimatedDeliveryDate: string | null;
      action: SellerFulfillmentAction;
      trackingCarrier: string | null;
      trackingNumber: string | null;
      auditLogId: string;
      previousStatus: "PENDING";
      newStatus: "SHIPPED" | "READY_FOR_PICKUP";
    };

export type BuyerReceiptAuthorityResult =
  | { outcome: "unauthorized" }
  | { outcome: "conflict"; reason: OrderFulfillmentConflictReason }
  | {
      outcome: "changed";
      orderId: string;
      sellerUserId: string | null;
      action: "delivered" | "picked_up";
      fulfillmentMethod: "SHIPPING" | "PICKUP";
      auditLogId: string;
      previousStatus: "SHIPPED" | "READY_FOR_PICKUP";
      newStatus: "DELIVERED" | "PICKED_UP";
    };

export type SellerNotesAuthorityResult =
  | { outcome: "unauthorized" }
  | { outcome: "conflict"; reason: OrderFulfillmentConflictReason }
  | {
      outcome: "changed";
      orderId: string;
      auditLogId: string;
      hasNotes: boolean;
    };

function normalizedOrderId(value: string) {
  if (typeof value !== "string" || !ORDER_ID_PATTERN.test(value)) {
    throw new TypeError("Order fulfillment order id is invalid");
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} returned a non-object result`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireNullableString(value: unknown, label: string, maxLength: number) {
  return value === null || value === undefined
    ? null
    : requireString(value, label, maxLength);
}

function requireConflictReason(value: unknown): OrderFulfillmentConflictReason {
  const reason = requireString(value, "Order fulfillment conflict reason", 64);
  const allowed: readonly OrderFulfillmentConflictReason[] = [
    "unpaid",
    "refunded",
    "open_dispute",
    "active_case",
    "seller_deauthorized",
    "state_changed",
    "method_mismatch",
    "label_purchased",
    "buyer_data_purged",
  ];
  if (!allowed.includes(reason as OrderFulfillmentConflictReason)) {
    throw new TypeError("Order fulfillment conflict reason is unrecognized");
  }
  return reason as OrderFulfillmentConflictReason;
}

type ParsedBaseResult =
  | { outcome: "unauthorized" }
  | { outcome: "conflict"; reason: OrderFulfillmentConflictReason }
  | ({ outcome: "changed" } & Record<string, unknown>);

function baseResult(value: unknown, label: string): ParsedBaseResult {
  if (value === null || value === undefined) {
    return { outcome: "unauthorized" } as const;
  }
  const row = requireRecord(value, label);
  if (row.outcome === "conflict") {
    return { outcome: "conflict", reason: requireConflictReason(row.reason) } as const;
  }
  if (row.outcome !== "changed") {
    throw new TypeError(`${label} outcome is invalid`);
  }
  return { ...row, outcome: "changed" };
}

function requireIdentity(row: Record<string, unknown>, orderId: string, label: string) {
  const returnedOrderId = requireString(row.orderId, `${label} Order id`, 191);
  if (returnedOrderId !== orderId) {
    throw new TypeError(`${label} changed Order identity`);
  }
  return returnedOrderId;
}

export async function transitionSellerOrderFulfillment(
  input: {
    actorUserId: string;
    orderId: string;
    action: SellerFulfillmentAction;
    trackingCarrier?: string | null;
    trackingNumber?: string | null;
  },
  client: OrderFulfillmentClient = prisma,
): Promise<SellerFulfillmentAuthorityResult> {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const orderId = normalizedOrderId(input.orderId);
  if (input.action !== "shipped" && input.action !== "ready_for_pickup") {
    throw new TypeError("Order seller-fulfillment action is invalid");
  }
  const rows = await client.$queryRaw<Array<{ result: unknown }>>(Prisma.sql`
    SELECT public.grainline_order_seller_fulfillment_transition(
      ${actorUserId}::text,
      ${orderId}::text,
      ${input.action}::text,
      ${input.trackingCarrier ?? null}::text,
      ${input.trackingNumber ?? null}::text
    ) AS result
  `);
  if (rows.length !== 1) {
    throw new TypeError("Order seller-fulfillment returned invalid cardinality");
  }
  const base = baseResult(rows[0].result, "Order seller-fulfillment");
  if (base.outcome !== "changed") return base;
  const action = requireString(base.action, "Order seller-fulfillment action", 32);
  if (action !== input.action) {
    throw new TypeError("Order seller-fulfillment changed action identity");
  }
  const newStatus = requireString(base.newStatus, "Order seller-fulfillment status", 32);
  const expectedStatus = input.action === "shipped" ? "SHIPPED" : "READY_FOR_PICKUP";
  if (newStatus !== expectedStatus || base.previousStatus !== "PENDING") {
    throw new TypeError("Order seller-fulfillment returned an invalid transition");
  }
  return {
    outcome: "changed",
    orderId: requireIdentity(base, orderId, "Order seller-fulfillment"),
    buyerUserId: requireNullableString(base.buyerUserId, "Order buyer user", 191),
    buyerName: requireNullableString(base.buyerName, "Order buyer name", 200),
    buyerEmail: requireNullableString(base.buyerEmail, "Order buyer email", 254),
    sellerDisplayName: requireNullableString(
      base.sellerDisplayName,
      "Order seller display name",
      200,
    ),
    estimatedDeliveryDate: requireNullableString(
      base.estimatedDeliveryDate,
      "Order estimated delivery date",
      64,
    ),
    action: input.action,
    trackingCarrier: requireNullableString(base.trackingCarrier, "Order tracking carrier", 100),
    trackingNumber: requireNullableString(base.trackingNumber, "Order tracking number", 100),
    auditLogId: requireString(base.auditLogId, "Order fulfillment audit id", AUDIT_ID_MAX_LENGTH),
    previousStatus: "PENDING",
    newStatus: expectedStatus,
  };
}

export async function confirmBuyerOrderReceipt(
  input: { actorUserId: string; orderId: string },
  client: OrderFulfillmentClient = prisma,
): Promise<BuyerReceiptAuthorityResult> {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const orderId = normalizedOrderId(input.orderId);
  const rows = await client.$queryRaw<Array<{ result: unknown }>>(Prisma.sql`
    SELECT public.grainline_order_buyer_receipt_confirm(
      ${actorUserId}::text,
      ${orderId}::text
    ) AS result
  `);
  if (rows.length !== 1) {
    throw new TypeError("Order buyer receipt returned invalid cardinality");
  }
  const base = baseResult(rows[0].result, "Order buyer receipt");
  if (base.outcome !== "changed") return base;
  const action = requireString(base.action, "Order receipt action", 32);
  const method = requireString(base.fulfillmentMethod, "Order receipt method", 16);
  const previousStatus = requireString(base.previousStatus, "Order receipt previous status", 32);
  const newStatus = requireString(base.newStatus, "Order receipt new status", 32);
  const delivery = action === "delivered"
    && method === "SHIPPING"
    && previousStatus === "SHIPPED"
    && newStatus === "DELIVERED";
  const pickup = action === "picked_up"
    && method === "PICKUP"
    && previousStatus === "READY_FOR_PICKUP"
    && newStatus === "PICKED_UP";
  if (!delivery && !pickup) {
    throw new TypeError("Order buyer receipt returned an invalid transition");
  }
  return {
    outcome: "changed",
    orderId: requireIdentity(base, orderId, "Order buyer receipt"),
    sellerUserId: requireNullableString(base.sellerUserId, "Order seller user", 191),
    action: action as "delivered" | "picked_up",
    fulfillmentMethod: method as "SHIPPING" | "PICKUP",
    auditLogId: requireString(base.auditLogId, "Order receipt audit id", AUDIT_ID_MAX_LENGTH),
    previousStatus: previousStatus as "SHIPPED" | "READY_FOR_PICKUP",
    newStatus: newStatus as "DELIVERED" | "PICKED_UP",
  };
}

export async function updateSellerOrderNotes(
  input: { actorUserId: string; orderId: string; sellerNotes: string | null },
  client: OrderFulfillmentClient = prisma,
): Promise<SellerNotesAuthorityResult> {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const orderId = normalizedOrderId(input.orderId);
  if (input.sellerNotes !== null && input.sellerNotes.length > 2000) {
    throw new TypeError("Order seller notes are too long");
  }
  const rows = await client.$queryRaw<Array<{ result: unknown }>>(Prisma.sql`
    SELECT public.grainline_order_seller_notes_update(
      ${actorUserId}::text,
      ${orderId}::text,
      ${input.sellerNotes}::text
    ) AS result
  `);
  if (rows.length !== 1) {
    throw new TypeError("Order seller-note update returned invalid cardinality");
  }
  const base = baseResult(rows[0].result, "Order seller-note update");
  if (base.outcome !== "changed") return base;
  if (typeof base.hasNotes !== "boolean" || base.hasNotes !== (input.sellerNotes !== null)) {
    throw new TypeError("Order seller-note update changed note presence");
  }
  return {
    outcome: "changed",
    orderId: requireIdentity(base, orderId, "Order seller-note update"),
    auditLogId: requireString(base.auditLogId, "Order seller-note audit id", AUDIT_ID_MAX_LENGTH),
    hasNotes: base.hasNotes,
  };
}

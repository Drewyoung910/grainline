import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

// A receipt is co-committed user-workflow evidence, not an expiring cache lock.
// Unknown requests older than this window cannot be applied after receipt retention.
export const STOCK_MUTATION_WINDOW_MS = 24 * 60 * 60 * 1000;
export class StockMutationConflict extends Error {}
export class StockMutationExpired extends StockMutationConflict {
  readonly mutationId: string;
  readonly stockQuantity: number | null;
  constructor(mutationId: string, stockQuantity: number | null) {
    super("This stock save was not applied: its time window expired. Review current stock and check your device clock before saving again.");
    this.mutationId = mutationId;
    this.stockQuantity = stockQuantity;
  }
}
export type StockMutationIdentity = { mutationId: string; issuedAt: number };
type Client = Pick<Prisma.TransactionClient, "$queryRaw" | "systemAuditLog">;
type Scope = { listingId: string; sellerId: string; actorId: string };
export type LockedListingStock = {
  id: string; title: string; stockQuantity: number | null; listingType: "IN_STOCK" | "MADE_TO_ORDER";
  status: string; isPrivate: boolean; rejectionReason: string | null;
};
const ACTION = "MANUAL_LISTING_STOCK_ADJUSTMENT";

export function validStockMutationIdentity(value: StockMutationIdentity) {
  return typeof value.mutationId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.mutationId)
    && Number.isSafeInteger(value.issuedAt) && value.issuedAt > 0;
}

export async function lockListingStock(client: Client, scope: Pick<Scope, "listingId" | "sellerId">) {
  const [listing] = await client.$queryRaw<LockedListingStock[]>`
    SELECT id, title, "stockQuantity", "listingType"::text AS "listingType",
      status::text AS status, "isPrivate", "rejectionReason"
    FROM "Listing" WHERE id = ${scope.listingId} AND "sellerId" = ${scope.sellerId}
    FOR UPDATE
  `;
  return listing ?? null;
}

export async function prepareListingStockMutation(
  client: Client, scope: Scope, identity: StockMutationIdentity,
  payload: Record<string, string | number | null>, now = Date.now,
) {
  if (!validStockMutationIdentity(identity)) throw new StockMutationConflict("Invalid stock operation. Refresh inventory.");
  const listing = await lockListingStock(client, scope);
  if (!listing) return null;
  const id = `stock-adjustment:${createHash("sha256")
    .update(JSON.stringify([scope.actorId, scope.listingId, identity.mutationId])).digest("hex")}`;
  const requestHash = createHash("sha256").update(JSON.stringify({
    issuedAt: identity.issuedAt,
    payload: Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))),
  })).digest("hex");
  const prior = await client.systemAuditLog.findUnique({ where: { id } });
  if (prior) {
    const metadata = prior.metadata as Record<string, unknown> | null;
    if (prior.actorType !== "user" || prior.actorId !== scope.actorId || prior.action !== ACTION
      || prior.targetType !== "LISTING" || prior.targetId !== scope.listingId
      || !metadata || metadata.version !== 1 || metadata.requestHash !== requestHash) {
      throw new StockMutationConflict("This stock operation has different saved details. Refresh and reconcile inventory.");
    }
    return { id, requestHash, scope, listing, replayed: true as const, result: metadata.result };
  }
  // Evaluate after the row lock and receipt lookup, not before waiting for them.
  const age = now() - identity.issuedAt;
  if (!Number.isFinite(age) || age < -60_000 || age >= STOCK_MUTATION_WINDOW_MS) {
    throw new StockMutationExpired(identity.mutationId, listing.stockQuantity);
  }
  return { id, requestHash, scope, listing, replayed: false as const, result: undefined };
}

export async function recordListingStockMutation(
  client: Client, claim: NonNullable<Awaited<ReturnType<typeof prepareListingStockMutation>>>,
  result: Prisma.InputJsonObject,
) {
  if (claim.replayed) throw new StockMutationConflict("Cannot replace a saved stock operation.");
  await client.systemAuditLog.create({ data: {
    id: claim.id, actorType: "user", actorId: claim.scope.actorId,
    action: ACTION, targetType: "LISTING", targetId: claim.scope.listingId,
    metadata: { version: 1, requestHash: claim.requestHash, result },
  } });
}

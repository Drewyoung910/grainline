import { MAX_MANUAL_STOCK_QUANTITY } from "./stockMutationState.ts";

export type InventoryStockAttempt = {
  mutationId: string; issuedAt: number; quantity: number; expectedQuantity: number;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
function validQuantity(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_MANUAL_STOCK_QUANTITY;
}
export function readInventoryStockAttempt(storage: Storage, key: string): InventoryStockAttempt | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const value = JSON.parse(raw) as InventoryStockAttempt | null;
  if (!value || typeof value.mutationId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.mutationId)
    || !Number.isSafeInteger(value.issuedAt) || value.issuedAt <= 0
    || !validQuantity(value.quantity) || !validQuantity(value.expectedQuantity)) {
    throw new Error("Saved stock attempt could not be recovered. Contact support before another adjustment.");
  }
  return value;
}
export function prepareInventoryStockAttempt(
  storage: Storage, key: string, quantity: number, expectedQuantity: number,
  now = Date.now(), mutationId = crypto.randomUUID(),
) {
  const prior = readInventoryStockAttempt(storage, key);
  if (prior) {
    if (prior.quantity !== quantity) throw new Error("Retry the pending stock save before changing the quantity.");
    return prior;
  }
  if (!validQuantity(quantity) || !validQuantity(expectedQuantity)) throw new Error("Enter a valid stock quantity.");
  const attempt = { mutationId, issuedAt: now, quantity, expectedQuantity };
  // Do not start the request if its restart state cannot be retained.
  storage.setItem(key, JSON.stringify(attempt));
  if (JSON.stringify(readInventoryStockAttempt(storage, key)) !== JSON.stringify(attempt)) {
    throw new Error("Stock attempt was not saved. No adjustment was sent.");
  }
  return attempt;
}
export function acknowledgeInventoryStockAttempt(storage: Storage, key: string, mutationId: string, response: unknown) {
  const saved = readInventoryStockAttempt(storage, key);
  const result = response as { mutationId?: unknown; stockQuantity?: unknown } | null;
  if (!saved || saved.mutationId !== mutationId || result?.mutationId !== mutationId
    || typeof result.stockQuantity !== "number" || !Number.isSafeInteger(result.stockQuantity) || result.stockQuantity < 0) {
    throw new Error("Stock save acknowledgement is incomplete. Retry the same save.");
  }
  storage.removeItem(key);
  return result.stockQuantity;
}

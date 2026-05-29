import type { AnonymousCartItem } from "./anonymousCart";
import { mapWithConcurrency } from "./concurrency.ts";

export const ANONYMOUS_CART_MERGE_CONCURRENCY = 4;

export type AnonymousCartAddResult =
  | { ok: true }
  | { ok: false; status?: number | null; error?: string | null };

export type AnonymousCartMergeResult = {
  mergedCount: number;
  rejectedCount: number;
  retryableFailure: boolean;
  remainingItems: AnonymousCartItem[];
  errors: string[];
};

export function isRetryableAnonymousCartMergeStatus(status: number | null | undefined): boolean {
  if (status == null) return true;
  if (status === 401 || status === 408 || status === 409 || status === 425 || status === 429) return true;
  return status >= 500 && status <= 599;
}

function retryableMessage(status: number | null | undefined, error: string | null | undefined): string {
  if (status === 401) return "Sign in again to restore your saved cart.";
  return error || "Saved cart items could not be restored right now.";
}

function rejectedMessage(item: AnonymousCartItem, error: string | null | undefined): string {
  return error || `${item.snapshot.title} could not be added to your cart.`;
}

function displayErrors(errors: string[]): string[] {
  return [...new Set(errors.map((error) => error.trim()).filter(Boolean))].slice(0, 3);
}

export async function mergeAnonymousCartItemsToAccount(
  items: AnonymousCartItem[],
  addItem: (item: AnonymousCartItem) => Promise<AnonymousCartAddResult>,
  concurrency = ANONYMOUS_CART_MERGE_CONCURRENCY,
): Promise<AnonymousCartMergeResult> {
  let mergedCount = 0;
  let rejectedCount = 0;
  let retryableFailure = false;
  const remainingItems: AnonymousCartItem[] = [];
  const errors: string[] = [];

  const attempts = await mapWithConcurrency(items, concurrency, async (item) => addItem(item));

  for (let index = 0; index < attempts.length; index += 1) {
    const item = items[index];
    const attempt = attempts[index];

    if (attempt.status === "rejected") {
      retryableFailure = true;
      remainingItems.push(item);
      errors.push("Saved cart items could not be restored right now.");
      continue;
    }

    const result = attempt.value;
    if (result.ok) {
      mergedCount += 1;
      continue;
    }

    if (isRetryableAnonymousCartMergeStatus(result.status)) {
      retryableFailure = true;
      remainingItems.push(item);
      errors.push(retryableMessage(result.status, result.error));
      continue;
    }

    rejectedCount += 1;
    errors.push(rejectedMessage(item, result.error));
  }

  return {
    mergedCount,
    rejectedCount,
    retryableFailure,
    remainingItems,
    errors: displayErrors(errors),
  };
}

import type { AnonymousCartItem } from "./anonymousCart";

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
): Promise<AnonymousCartMergeResult> {
  let mergedCount = 0;
  let rejectedCount = 0;
  let retryableFailure = false;
  const remainingItems: AnonymousCartItem[] = [];
  const errors: string[] = [];

  for (const item of items) {
    try {
      const result = await addItem(item);
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
    } catch {
      retryableFailure = true;
      remainingItems.push(item);
      errors.push("Saved cart items could not be restored right now.");
    }
  }

  return {
    mergedCount,
    rejectedCount,
    retryableFailure,
    remainingItems,
    errors: displayErrors(errors),
  };
}

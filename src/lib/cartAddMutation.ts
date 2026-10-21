export type CartAddMutationResult<T> =
  | { ok: true; item: T | null }
  | { ok: false; reason: "quantity_limit" };

type CartAddMutationInput<T> = {
  existingQuantity: number | null;
  madeToOrder: boolean;
  create: () => Promise<T>;
  markMadeToOrder: () => Promise<unknown>;
  increment: () => Promise<{ count: number }>;
  readUpdated: () => Promise<T | null>;
};

/**
 * Apply one cart-line mutation after the owning Cart row has been locked.
 *
 * PostgreSQL aborts a transaction after a unique-constraint violation. Do not
 * attempt an insert and catch P2002 when the locked read already found the
 * line; choose create or update before issuing the write.
 */
export async function applyCartAddMutation<T>(
  input: CartAddMutationInput<T>,
): Promise<CartAddMutationResult<T>> {
  if (input.existingQuantity == null) {
    return { ok: true, item: await input.create() };
  }

  if (input.madeToOrder) {
    await input.markMadeToOrder();
  } else {
    const updated = await input.increment();
    if (updated.count === 0) {
      return { ok: false, reason: "quantity_limit" };
    }
  }

  return { ok: true, item: await input.readUpdated() };
}

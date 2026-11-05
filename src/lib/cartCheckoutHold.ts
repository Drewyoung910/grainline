// A checkout session left open keeps holding the buyer's own stock, so the cart
// must not call that stock gone. Finished sessions are not a hold: they belong
// on the receipt, and must not take over an ordinary visit to the cart.
export type HeldCheckout = Readonly<{
  sellerIds: readonly string[];
  sessionIds: readonly string[];
}>;

export function heldCheckoutFromResume(data: unknown): HeldCheckout | null {
  const entries = (data as { clientSecrets?: unknown } | null)?.clientSecrets;
  if (!Array.isArray(entries)) return null;
  const open = entries.filter((entry): entry is { sellerId: string; sessionId: string } =>
    typeof entry?.sellerId === "string" && typeof entry?.sessionId === "string");
  if (open.length === 0) return null;
  return Object.freeze({
    sellerIds: open.map((entry) => entry.sellerId),
    sessionIds: open.map((entry) => entry.sessionId),
  });
}

export const CHECKOUT_SUCCESS_SESSION_LIMIT = 50;

export function checkoutSuccessSessionIds(input: {
  sessionId?: string | null;
  sessionIds?: string | null;
  limit?: number;
}) {
  const limit = input.limit ?? CHECKOUT_SUCCESS_SESSION_LIMIT;
  const orderedIds = [
    ...(input.sessionIds ?? "").split(","),
    input.sessionId ?? "",
  ]
    .map((id) => id.trim())
    .filter((id) => /^cs_/.test(id));
  const uniqueIds = [...new Set(orderedIds)];
  return {
    sessionIds: uniqueIds.slice(0, limit),
    truncatedCount: Math.max(0, uniqueIds.length - limit),
  };
}

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
    .filter((id) => id.startsWith("cs_") && id.length <= 255);
  const uniqueIds = [...new Set(orderedIds)];
  return {
    sessionIds: uniqueIds.slice(0, limit),
    truncatedCount: Math.max(0, uniqueIds.length - limit),
  };
}

// A repeated query parameter reaches the page as an array.
export function checkoutSuccessParams(params: {
  session_id?: string | string[];
  session_ids?: string | string[];
} | null | undefined) {
  const rawSessionId = params?.session_id;
  const rawSessionIds = params?.session_ids;
  return {
    sessionId: Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId,
    sessionIds: Array.isArray(rawSessionIds) ? rawSessionIds.join(",") : rawSessionIds,
  };
}

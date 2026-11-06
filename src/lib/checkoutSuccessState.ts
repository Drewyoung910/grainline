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
    // Stripe session ids are cs_ plus letters, digits and underscores. Anything
    // else (a NUL, for one) would reach the receipt query and fail as a 500.
    .filter((id) => /^cs_[A-Za-z0-9_]{1,252}$/.test(id));
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

// Provider orchestration only. Account identity is written by our checkout
// routes from the same destination used for payment_intent_data, never a
// buyer-supplied field. Existing database operations still own stock changes.
export type ClosureCheckoutSession = {
  id: string;
  status: "open" | "complete" | "expired" | null;
  metadata: Record<string, string> | null;
};

type ClosureSessionDependencies<T extends ClosureCheckoutSession> = {
  list: (params: {
    created: { gte: number };
    limit: 100;
    starting_after?: string;
  }) => Promise<{ data: T[]; has_more: boolean }>;
  expire: (id: string) => Promise<T>;
  retrieve: (id: string) => Promise<T>;
  restore: (session: T) => Promise<void>;
};

export async function expireClosedSellerAccountSessions<T extends ClosureCheckoutSession>(
  input: { sellerId: string; accountId: string; nowSeconds: number },
  deps: ClosureSessionDependencies<T>,
) {
  if (!input.sellerId || input.sellerId.length > 191 ||
      !/^acct_[A-Za-z0-9_]+$/.test(input.accountId) || input.accountId.length > 255 ||
      !Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 7200) {
    throw new Error("Invalid seller closure session scope");
  }
  const result = { checked: 0, expired: 0, restored: 0 };
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    // Include expired sessions: a previous attempt may have expired a session
    // successfully and then failed before restoring its reservation.
    const sessions = await deps.list({
      created: { gte: input.nowSeconds - 2 * 60 * 60 },
      limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    });
    if (!Array.isArray(sessions.data) || sessions.data.length > 100 ||
        typeof sessions.has_more !== "boolean") {
      throw new Error("Seller closure session page is invalid");
    }
    for (const listed of sessions.data) {
      if (!/^cs_[A-Za-z0-9_]+$/.test(listed.id) || listed.id.length > 255 || seen.has(listed.id)) {
        throw new Error("Seller closure session pagination did not advance");
      }
      seen.add(listed.id);
      if (listed.metadata?.sellerId !== input.sellerId) continue;
      if (listed.status === "complete") continue;
      const destination = listed.metadata.sellerStripeAccountId;
      if (!destination) {
        // Predecessor sessions cannot safely be assigned to the closed account.
        // Keep delivery retryable while they are payable. Once expired, the
        // existing reservation worker owns their stock repair.
        if (listed.status === "expired") continue;
        throw new Error("Seller closure found a payable session without account binding");
      }
      if (destination !== input.accountId) continue;
      result.checked += 1;
      let current = listed;
      if (current.status === "open") {
        try {
          current = await deps.expire(listed.id);
        } catch (error) {
          // Expiry may have succeeded before transport failed, or payment may
          // have won the race. Read that exact session before deciding.
          current = await deps.retrieve(listed.id);
          if (current.status === "open") throw error;
        }
        if (current.id !== listed.id || current.metadata?.sellerId !== input.sellerId ||
            current.metadata.sellerStripeAccountId !== input.accountId) {
          throw new Error("Seller closure session identity changed");
        }
        if (current.status === "complete") continue;
        if (current.status === "expired") result.expired += 1;
      }
      if (current.status !== "expired") {
        throw new Error("Seller closure session state is unresolved");
      }
      await deps.restore(current);
      result.restored += 1;
    }
    if (!sessions.has_more) return result;
    if (sessions.data.length === 0) {
      throw new Error("Seller closure session pagination is incomplete");
    }
    cursor = sessions.data.at(-1)!.id;
  }
  throw new Error("Seller closure session page budget exhausted");
}

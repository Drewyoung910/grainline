export type BlockedPairCheckoutSession = {
  id: string;
  metadata: Record<string, string> | null;
};

type BlockedPairTarget = {
  buyerId: string;
  sellerId: string;
};

type BlockedPairSessionDependencies<T extends BlockedPairCheckoutSession> = {
  list: (params: {
    created: { gte: number };
    limit: 100;
    status: "open";
    starting_after?: string;
  }) => Promise<{ data: T[]; has_more: boolean }>;
  expire: (id: string) => Promise<unknown>;
  restore: (session: T, sellerId: string) => Promise<void>;
  report: (error: unknown, context: {
    stage: "expire" | "restore";
    sessionId: string;
    buyerId: string;
    sellerId: string;
  }) => void;
};

function validUserIdentifier(value: string) {
  return /^[A-Za-z0-9._:-]{1,191}$/.test(value);
}

export async function expireBlockedPairCheckoutSessions<
  T extends BlockedPairCheckoutSession,
>(
  input: {
    targets: BlockedPairTarget[];
    nowSeconds: number;
    lookbackSeconds?: number;
  },
  deps: BlockedPairSessionDependencies<T>,
) {
  if (!Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 1) {
    throw new Error("Invalid blocked-pair checkout expiry clock");
  }
  const lookbackSeconds = input.lookbackSeconds ?? 2 * 60 * 60;
  if (!Number.isSafeInteger(lookbackSeconds) || lookbackSeconds < 60 || lookbackSeconds > 24 * 60 * 60) {
    throw new Error("Invalid blocked-pair checkout expiry window");
  }

  const targets = new Map<string, BlockedPairTarget>();
  for (const target of input.targets) {
    if (!validUserIdentifier(target.buyerId) || !validUserIdentifier(target.sellerId)) {
      throw new Error("Invalid blocked-pair checkout expiry target");
    }
    targets.set(`${target.buyerId}\u0000${target.sellerId}`, target);
  }
  const result = { checked: 0, expired: 0, failed: 0 };
  if (targets.size === 0) return result;

  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const sessions = await deps.list({
      created: { gte: input.nowSeconds - lookbackSeconds },
      limit: 100,
      status: "open",
      ...(cursor ? { starting_after: cursor } : {}),
    });
    if (!Array.isArray(sessions.data) || sessions.data.length > 100 ||
        typeof sessions.has_more !== "boolean") {
      throw new Error("Blocked-pair checkout session page is invalid");
    }
    for (const session of sessions.data) {
      if (!/^cs_[A-Za-z0-9_]+$/.test(session.id) || session.id.length > 255 || seen.has(session.id)) {
        throw new Error("Blocked-pair checkout session pagination did not advance");
      }
      seen.add(session.id);
      const buyerId = session.metadata?.buyerId;
      const sellerId = session.metadata?.sellerId;
      if (!buyerId || !sellerId || !targets.has(`${buyerId}\u0000${sellerId}`)) continue;

      result.checked += 1;
      try {
        await deps.expire(session.id);
      } catch (error) {
        result.failed += 1;
        deps.report(error, { stage: "expire", sessionId: session.id, buyerId, sellerId });
        continue;
      }
      try {
        await deps.restore(session, sellerId);
        result.expired += 1;
      } catch (error) {
        result.failed += 1;
        deps.report(error, { stage: "restore", sessionId: session.id, buyerId, sellerId });
      }
    }
    if (!sessions.has_more) return result;
    if (sessions.data.length === 0) {
      throw new Error("Blocked-pair checkout session pagination is incomplete");
    }
    cursor = sessions.data.at(-1)!.id;
  }
  throw new Error("Blocked-pair checkout session page budget exhausted");
}

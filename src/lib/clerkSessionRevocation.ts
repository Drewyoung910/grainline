type ClerkSessionClient = {
  sessions: {
    getSessionList(input: {
      userId: string;
      status: "active";
      limit: number;
      offset: number;
    }): Promise<{ data: Array<{ id: string }>; totalCount: number }>;
    revokeSession(sessionId: string): Promise<unknown>;
  };
};

const CLERK_SESSION_PAGE_SIZE = 100;
const CLERK_SESSION_REVOCATION_CONCURRENCY = 10;
const CLERK_SESSION_REVOCATION_LIMIT = 500;

export async function revokeActiveClerkSessions(
  clerk: ClerkSessionClient,
  clerkUserId: string,
): Promise<{ revokedSessionCount: number }> {
  let revokedSessionCount = 0;

  while (revokedSessionCount < CLERK_SESSION_REVOCATION_LIMIT) {
    // Always read offset zero. Successfully revoked active sessions leave this
    // result set, so an offset would skip sessions after each page.
    const page = await clerk.sessions.getSessionList({
      userId: clerkUserId,
      status: "active",
      limit: Math.min(
        CLERK_SESSION_PAGE_SIZE,
        CLERK_SESSION_REVOCATION_LIMIT - revokedSessionCount,
      ),
      offset: 0,
    });
    if (page.data.length === 0) {
      return { revokedSessionCount };
    }

    for (let start = 0; start < page.data.length; start += CLERK_SESSION_REVOCATION_CONCURRENCY) {
      const batch = page.data.slice(start, start + CLERK_SESSION_REVOCATION_CONCURRENCY);
      const revocations = await Promise.allSettled(
        batch.map((session) => clerk.sessions.revokeSession(session.id)),
      );
      revokedSessionCount += revocations.filter((result) => result.status === "fulfilled").length;
      const rejected = revocations.filter((result) => result.status === "rejected");
      if (rejected.length > 0) {
        throw new Error(`Failed to revoke ${rejected.length} Clerk session(s)`);
      }
    }
  }

  const remaining = await clerk.sessions.getSessionList({
    userId: clerkUserId,
    status: "active",
    limit: 1,
    offset: 0,
  });
  if (remaining.data.length > 0) {
    throw new Error("Clerk session revocation reached its per-attempt limit");
  }

  return { revokedSessionCount };
}

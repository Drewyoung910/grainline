import { clerkClient } from "@clerk/nextjs/server";

type ClerkClient = Awaited<ReturnType<typeof clerkClient>>;

const CLERK_SESSION_PAGE_SIZE = 100;

async function activeSessionIds(clerk: ClerkClient, clerkUserId: string): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;

  for (;;) {
    const page = await clerk.sessions.getSessionList({
      userId: clerkUserId,
      status: "active",
      limit: CLERK_SESSION_PAGE_SIZE,
      offset,
    });
    ids.push(...page.data.map((session) => session.id));

    if (page.data.length === 0 || ids.length >= page.totalCount) break;
    offset += page.data.length;
  }

  return ids;
}

async function revokeActiveSessions(clerk: ClerkClient, clerkUserId: string): Promise<{
  revokedSessionCount: number;
}> {
  const sessionIds = await activeSessionIds(clerk, clerkUserId);
  const revocations = await Promise.allSettled(
    sessionIds.map((sessionId) => clerk.sessions.revokeSession(sessionId)),
  );
  const rejected = revocations.filter((result) => result.status === "rejected");
  if (rejected.length > 0) {
    throw new Error(`Failed to revoke ${rejected.length} Clerk session(s)`);
  }

  return { revokedSessionCount: sessionIds.length };
}

export async function revokeClerkUserSessions(clerkUserId: string): Promise<{
  revokedSessionCount: number;
}> {
  const clerk = await clerkClient();
  return revokeActiveSessions(clerk, clerkUserId);
}

export async function banClerkUserAndRevokeSessions(clerkUserId: string): Promise<{
  revokedSessionCount: number;
}> {
  const clerk = await clerkClient();
  await clerk.users.banUser(clerkUserId);
  return revokeActiveSessions(clerk, clerkUserId);
}

export async function unbanClerkUser(clerkUserId: string): Promise<void> {
  const clerk = await clerkClient();
  await clerk.users.unbanUser(clerkUserId);
}

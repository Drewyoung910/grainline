import { clerkClient } from "@clerk/nextjs/server";
import {
  clerkCurrentUserIdentityFromSnapshot,
  type ClerkCurrentUserIdentity,
} from "@/lib/clerkCurrentUserIdentity";
import { revokeActiveClerkSessions } from "@/lib/clerkSessionRevocation";

import { isClerkUserNotFoundError } from "@/lib/clerkCurrentUserIdentity";

export { isClerkUserNotFoundError };

/** False only for a definite 404. Any other failure throws, so callers stop. */
export async function clerkUserExists(clerkUserId: string): Promise<boolean> {
  const clerk = await clerkClient();
  try {
    await clerk.users.getUser(clerkUserId);
    return true;
  } catch (error) {
    if (isClerkUserNotFoundError(error)) return false;
    throw error;
  }
}

export async function getCurrentClerkUserIdentity(
  clerkUserId: string,
): Promise<ClerkCurrentUserIdentity> {
  const clerk = await clerkClient();
  const user = await clerk.users.getUser(clerkUserId);
  return clerkCurrentUserIdentityFromSnapshot(user, clerkUserId);
}

export async function revokeClerkUserSessions(clerkUserId: string): Promise<{
  revokedSessionCount: number;
}> {
  const clerk = await clerkClient();
  return revokeActiveClerkSessions(clerk, clerkUserId);
}

export async function banClerkUserAndRevokeSessions(clerkUserId: string): Promise<{
  revokedSessionCount: number;
}> {
  const clerk = await clerkClient();
  await clerk.users.banUser(clerkUserId);
  return revokeActiveClerkSessions(clerk, clerkUserId);
}

export async function unbanClerkUser(clerkUserId: string): Promise<void> {
  const clerk = await clerkClient();
  await clerk.users.unbanUser(clerkUserId);
}

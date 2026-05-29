import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";

export async function currentSupportRequestUserId() {
  let clerkUserId: string | null;
  try {
    ({ userId: clerkUserId } = await auth());
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "support_request_account_link_auth" } });
    return null;
  }
  if (!clerkUserId) return null;

  try {
    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { id: true },
    });
    return user?.id ?? null;
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "support_request_account_link_lookup" } });
    return null;
  }
}

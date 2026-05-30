import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { ensureUser } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { blockRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(blockRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many block actions."));

  let me: Awaited<ReturnType<typeof ensureUser>>;
  try {
    me = await ensureUser();
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { id: blockedId } = await params;
  if (blockedId === me.id) return privateJson({ error: "Cannot block yourself" }, { status: 400 });

  const target = await prisma.user.findUnique({
    where: { id: blockedId },
    select: { id: true, deletedAt: true },
  });
  if (!target || target.deletedAt) return privateJson({ error: "User not found" }, { status: 404 });

  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: me.id, blockedId } },
    create: { blockerId: me.id, blockedId },
    update: {},
  });

  // Remove reciprocal Follow rows (both directions)
  try {
    // If I follow their seller profile, remove
    const blockedSeller = await prisma.sellerProfile.findUnique({ where: { userId: blockedId }, select: { id: true } });
    if (blockedSeller) {
      await prisma.follow.deleteMany({ where: { followerId: me.id, sellerProfileId: blockedSeller.id } });
    }
    // If they follow my seller profile, remove
    const mySeller = await prisma.sellerProfile.findUnique({ where: { userId: me.id }, select: { id: true } });
    if (mySeller) {
      await prisma.follow.deleteMany({ where: { followerId: blockedId, sellerProfileId: mySeller.id } });
    }
  } catch (error) {
    console.error("Failed to remove follow rows after block:", error);
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "block_follow_cleanup" },
      extra: { blockerId: me.id, blockedId },
    });
  }

  return privateJson({ ok: true, blocked: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(blockRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many block actions."));

  let me: Awaited<ReturnType<typeof ensureUser>>;
  try {
    me = await ensureUser();
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { id: blockedId } = await params;

  await prisma.block.deleteMany({
    where: { blockerId: me.id, blockedId },
  });

  return privateJson({ ok: true, blocked: false });
}

import { auth } from "@clerk/nextjs/server";
import { ensureUser } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { blockRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { logServerError } from "@/lib/serverErrorLogger";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import {
  createUserBlock,
  deleteUserBlock,
} from "@/lib/blockMutationAccess";
import { expireOpenCheckoutSessionsForBlockedPair } from "@/lib/checkoutSessionExpiry";
import { after } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

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

  const blockCreated = await createUserBlock(me.id, blockedId);
  if (!blockCreated) return privateJson({ error: "User not found" }, { status: 404 });

  after(async () => {
    try {
      const expiry = await expireOpenCheckoutSessionsForBlockedPair({
        firstUserId: me.id,
        secondUserId: blockedId,
        source: "user_block",
      });
      if (expiry.failed > 0) {
        logServerError(new Error("Some blocked-pair checkout sessions could not be expired"), {
          source: "block_checkout_session_expiry",
          level: "warning",
          extra: { blockerId: me.id, blockedId, ...expiry },
        });
      }
    } catch (error) {
      // The Block remains authoritative even if Stripe is unavailable. The
      // signed paid-checkout writer revalidates the pair and refunds any payment
      // that wins this race.
      logServerError(error, {
        source: "block_checkout_session_expiry",
        level: "warning",
        extra: { blockerId: me.id, blockedId },
      });
    }
  });

  return privateJson({ ok: true, blocked: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

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

  await deleteUserBlock(me.id, blockedId);

  return privateJson({ ok: true, blocked: false });
}

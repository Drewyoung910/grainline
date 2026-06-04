import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { z } from "zod";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import {
  cartMutationRatelimit,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import { stripe } from "@/lib/stripe";
import {
  restoreUnorderedCheckoutStockOnce,
  type CheckoutStockRestoreLineItem,
} from "@/lib/checkoutStockRestore";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { privateJson, privateResponse } from "@/lib/privateResponse";

const RollbackSchema = z.object({
  sessionIds: z.array(z.string().min(1)).min(1).max(20),
});

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";
const CHECKOUT_ROLLBACK_BODY_MAX_BYTES = 16 * 1024;

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId)
      return privateJson({ error: "Sign in required" }, { status: 401 });

    const me = await ensureUserByClerkId(userId);
    const rl = await safeRateLimit(cartMutationRatelimit, me.id);
    if (!rl.success) {
      return privateResponse(
        rateLimitResponse(
          rl.reset,
          "Too many requests. Please try again in a moment.",
        ),
      );
    }

    let parsed;
    try {
      parsed = RollbackSchema.parse(
        await readBoundedJson(req, CHECKOUT_ROLLBACK_BODY_MAX_BYTES),
      );
    } catch (error) {
      if (isRequestBodyTooLargeError(error)) {
        return privateJson(
          { error: "Request body too large" },
          { status: 413 },
        );
      }
      if (isInvalidJsonBodyError(error)) {
        return privateJson({ error: "Invalid JSON" }, { status: 400 });
      }
      if (error instanceof z.ZodError) {
        return privateJson(
          { error: "Invalid input", details: error.issues },
          { status: 400 },
        );
      }
      throw error;
    }

    const sessionIds = [...new Set(parsed.sessionIds)];
    const sessions: Array<{
      session: Stripe.Checkout.Session;
      metadata: Record<string, string | undefined>;
    }> = [];
    for (const sessionId of sessionIds) {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["line_items.data.price.product"],
      });
      const metadata = (session.metadata ?? {}) as Record<
        string,
        string | undefined
      >;
      if (metadata.buyerId !== me.id) {
        return privateJson(
          { error: "Checkout session not found" },
          { status: 403 },
        );
      }
      sessions.push({ session, metadata });
    }

    const results: Array<{
      sessionId: string;
      status: "restored" | "skipped" | "failed";
      reason?: string;
    }> = [];

    for (const { session, metadata } of sessions) {
      const sessionId = session.id;
      if (session.payment_status === "paid" || session.status === "complete") {
        results.push({
          sessionId,
          status: "skipped",
          reason: "not_restorable",
        });
        continue;
      }

      let shouldRestore = session.status === "expired";
      if (session.status === "open") {
        try {
          await stripe.checkout.sessions.expire(sessionId);
          shouldRestore = true;
        } catch (error) {
          Sentry.captureException(error, {
            tags: { source: "cart_checkout_rollback_expire" },
            extra: { stripeSessionId: sessionId },
          });
          results.push({
            sessionId,
            status: "failed",
            reason: "expire_failed",
          });
          continue;
        }
      }

      if (!shouldRestore) {
        results.push({
          sessionId,
          status: "skipped",
          reason: "not_restorable",
        });
        continue;
      }

      try {
        const lineItems =
          (
            session as {
              line_items?: { data?: CheckoutStockRestoreLineItem[] };
            }
          ).line_items?.data ?? [];
        await restoreUnorderedCheckoutStockOnce({
          sessionId,
          metadata,
          lineItems,
        });
        results.push({ sessionId, status: "restored" });
      } catch (error) {
        Sentry.captureException(error, {
          tags: { source: "cart_checkout_rollback_restore" },
          extra: { stripeSessionId: sessionId },
        });
        results.push({ sessionId, status: "failed", reason: "restore_failed" });
      }
    }

    return privateJson({
      ok: results.every((result) => result.status !== "failed"),
      results,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "cart_checkout_rollback" },
    });
    return privateJson(
      { error: "Server error rolling back checkout" },
      { status: 500 },
    );
  }
}

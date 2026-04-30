import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { z } from "zod";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { cartMutationRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { stripe } from "@/lib/stripe";
import {
  restoreUnorderedCheckoutStockOnce,
  type CheckoutStockRestoreLineItem,
} from "@/lib/checkoutStockRestore";

const RollbackSchema = z.object({
  sessionIds: z.array(z.string().min(1)).min(1).max(20),
});

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const me = await ensureUserByClerkId(userId);
    const rl = await safeRateLimit(cartMutationRatelimit, me.id);
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again in a moment." },
        { status: 429 },
      );
    }

    let parsed;
    try {
      parsed = RollbackSchema.parse(await req.json());
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
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
      const metadata = (session.metadata ?? {}) as Record<string, string | undefined>;
      if (metadata.buyerId !== me.id) {
        return NextResponse.json({ error: "Checkout session not found" }, { status: 403 });
      }
      sessions.push({ session, metadata });
    }

    const results: Array<{ sessionId: string; status: "restored" | "skipped" | "failed"; reason?: string }> = [];

    for (const { session, metadata } of sessions) {
      const sessionId = session.id;
      if (session.payment_status === "paid" || session.status === "complete") {
        results.push({ sessionId, status: "skipped", reason: "not_restorable" });
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
          results.push({ sessionId, status: "failed", reason: "expire_failed" });
          continue;
        }
      }

      if (!shouldRestore) {
        results.push({ sessionId, status: "skipped", reason: "not_restorable" });
        continue;
      }

      try {
        const lineItems =
          (session as { line_items?: { data?: CheckoutStockRestoreLineItem[] } }).line_items?.data ?? [];
        await restoreUnorderedCheckoutStockOnce({ sessionId, metadata, lineItems });
        results.push({ sessionId, status: "restored" });
      } catch (error) {
        Sentry.captureException(error, {
          tags: { source: "cart_checkout_rollback_restore" },
          extra: { stripeSessionId: sessionId },
        });
        results.push({ sessionId, status: "failed", reason: "restore_failed" });
      }
    }

    return NextResponse.json({
      ok: results.every((result) => result.status !== "failed"),
      results,
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "cart_checkout_rollback" } });
    return NextResponse.json({ error: "Server error rolling back checkout" }, { status: 500 });
  }
}

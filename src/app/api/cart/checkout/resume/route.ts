import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { cartCheckoutLockKey, getCheckoutLock } from "@/lib/checkoutSessionLock";
import { stripe } from "@/lib/stripe";
import { checkoutRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { logServerError } from "@/lib/serverErrorLogger";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";

type ResumedShippingAddress = {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  phone: string | null;
};

function shippingAddressFromMetadata(metadata: Record<string, string>): ResumedShippingAddress | null {
  const name = metadata.quotedToName;
  const line1 = metadata.quotedToLine1;
  const city = metadata.quotedToCity;
  const state = metadata.quotedToState;
  const postalCode = metadata.quotedToPostalCode;
  if (!name || !line1 || !city || !state || !postalCode) return null;
  return {
    name,
    line1,
    line2: metadata.quotedToLine2 || null,
    city,
    state,
    postalCode,
    phone: metadata.quotedToPhone || null,
  };
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return privateJson({ error: "Sign in required" }, { status: HTTP_STATUS.UNAUTHORIZED });

    const { success, reset } = await safeRateLimit(checkoutRatelimit, userId);
    if (!success) return privateResponse(rateLimitResponse(reset, "Too many checkout attempts."));

    const me = await ensureUserByClerkId(userId);
    const cart = await prisma.cart.findUnique({
      where: { userId: me.id },
      select: {
        id: true,
        items: {
          select: {
            listing: {
              select: {
                sellerId: true,
                seller: { select: { displayName: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      return privateJson({ clientSecrets: [], shippingAddress: null });
    }

    const sellers = new Map<string, string>();
    for (const item of cart.items) {
      if (!sellers.has(item.listing.sellerId)) {
        sellers.set(item.listing.sellerId, item.listing.seller.displayName);
      }
    }

    const clientSecrets: {
      sellerId: string;
      sellerName: string;
      secret: string;
      sessionId: string;
    }[] = [];
    const completedSessionIds: string[] = [];
    let shippingAddress: ResumedShippingAddress | null = null;

    for (const [sellerId, sellerName] of sellers) {
      const lock = await getCheckoutLock(cartCheckoutLockKey(cart.id, sellerId));
      if (lock?.state !== "ready" || !lock.sessionId || !lock.clientSecret) continue;

      const session = await stripe.checkout.sessions.retrieve(lock.sessionId);
      const metadata = session.metadata ?? {};
      if (
        metadata.buyerId !== me.id ||
        metadata.cartId !== cart.id ||
        metadata.sellerId !== sellerId ||
        metadata.checkoutLockKey !== cartCheckoutLockKey(cart.id, sellerId)
      ) {
        continue;
      }
      if (session.payment_status === "paid" || session.status === "complete") {
        completedSessionIds.push(session.id);
        shippingAddress ??= shippingAddressFromMetadata(metadata);
        continue;
      }
      if (session.status !== "open" || session.payment_status !== "unpaid") continue;

      const sessionClientSecret = typeof session.client_secret === "string" ? session.client_secret : lock.clientSecret;
      if (!sessionClientSecret) continue;

      shippingAddress ??= shippingAddressFromMetadata(metadata);
      clientSecrets.push({
        sellerId,
        sellerName,
        secret: sessionClientSecret,
        sessionId: session.id,
      });
    }

    return privateJson({ clientSecrets, completedSessionIds, shippingAddress });
  } catch (err) {
    if (isAccountAccessError(err)) {
      return privateJson({ error: err.message, code: err.code }, { status: err.status });
    }
    logServerError(err, { source: "cart_checkout_resume", tags: { route: "/api/cart/checkout/resume" } });
    return privateJson({ error: "Server error" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}

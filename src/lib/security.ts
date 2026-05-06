/**
 * CSRF Audit — Public POST/PATCH/DELETE routes (no auth() call)
 *
 * All Next.js API routes are implicitly CSRF-safe for browser-originated requests
 * because the Clerk middleware enforces SameSite cookie attributes and the App
 * Router does not set CORS headers by default, meaning cross-origin POSTs cannot
 * read the response. The routes below are intentionally unauthenticated and are
 * safe for the following reasons:
 *
 * 1. POST /api/stripe/webhook
 *    — Webhook called by Stripe servers using HTTPS POST with a raw body.
 *      Protected by Stripe-Signature HMAC verification (stripe.webhooks.constructEvent).
 *      No session cookie involved; CSRF not applicable.
 *
 * 2. POST /api/clerk/webhook
 *    — Webhook called by Clerk servers. Protected by svix signature verification
 *      (WebhookReceiver / Webhook.verify). No session cookie; CSRF not applicable.
 *
 * 3. POST /api/csp-report
 *    — Receives browser Content-Security-Policy violation reports. Read-only —
 *      no state mutation (only logs to Sentry). No sensitive data exposed.
 *      CSRF irrelevant for a write-only logging sink.
 *
 * 4. POST /api/newsletter
 *    — Upserts a NewsletterSubscriber row (email + name). No sensitive user
 *      data accessed; worst-case a cross-origin form could subscribe an email
 *      address the attacker already knows. Acceptable low-risk public action;
 *      protected by the public newsletter IP rate limiter.
 *
 * 5. POST /api/listings/[id]/view
 *    — Fire-and-forget analytics increment (viewCount). No user data accessed
 *      or modified. Deduplication via httpOnly cookie prevents double-counting.
 *      No sensitive mutation; CSRF not a concern.
 *
 * 6. POST /api/listings/[id]/click
 *    — Same as view tracking above. Analytics-only increment. No sensitive
 *      mutation; CSRF not a concern.
 *
 * All other POST/PATCH/DELETE routes call auth() from @clerk/nextjs/server and
 * return 401 before touching any data if no valid Clerk session is present.
 */
import * as Sentry from "@sentry/nextjs";

export type SecurityEventType =
  | "rate_limit_hit"
  | "ownership_violation"
  | "spam_attempt"
  | "invalid_input"
  | "account_state_violation"
  | "auth_challenge_failed"
  | "token_rejected";

export function logSecurityEvent(
  event: SecurityEventType,
  details: {
    userId?: string;
    ip?: string;
    route: string;
    reason: string;
    [key: string]: unknown;
  }
) {
  Sentry.addBreadcrumb({
    category: "security",
    message: `Security: ${event} on ${details.route}`,
    data: details,
    level: "warning",
  });

  if (
    event === "ownership_violation" ||
    event === "spam_attempt" ||
    event === "account_state_violation" ||
    event === "auth_challenge_failed" ||
    event === "token_rejected"
  ) {
    Sentry.captureEvent({
      message: `Security alert: ${event}`,
      level: "warning",
      extra: details,
      tags: { security_event: event, route: details.route },
    });
  }
}

import * as Sentry from "@sentry/nextjs";

export type SecurityEventType =
  | "rate_limit_hit"
  | "ownership_violation"
  | "spam_attempt"
  | "invalid_input";

export function logSecurityEvent(
  event: SecurityEventType,
  details: {
    userId?: string;
    ip?: string;
    route: string;
    reason: string;
  }
) {
  Sentry.addBreadcrumb({
    category: "security",
    message: `Security: ${event} on ${details.route}`,
    data: details,
    level: "warning",
  });

  if (event === "ownership_violation" || event === "spam_attempt") {
    Sentry.captureEvent({
      message: `Security alert: ${event}`,
      level: "warning",
      extra: details,
      tags: { security_event: event, route: details.route },
    });
  }
}

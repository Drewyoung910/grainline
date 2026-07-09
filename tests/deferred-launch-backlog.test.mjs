import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const backlog = source("docs/deferred-launch-backlog.md");

describe("deferred launch backlog", () => {
  it("keeps deferred work tracked outside the audit ledger", () => {
    assert.match(backlog, /87 deferred\s+product\/design\/ops\/legal findings/);
    assert.match(backlog, /0 unvetted raw allegations/);
    assert.match(backlog, /Deferred does not mean ignored/);
    assert.match(backlog, /Do not add a new deferred category/);
  });

  it("lists the current grouped deferred categories with closure criteria", () => {
    const requiredCategories = [
      "RLS staging and first table policy",
      "Stripe refund runtime reconciliation",
      "Stripe partial-refund reconciliation",
      "Shipping label clawback reconciliation",
      "Stripe webhook subscriptions",
      "Stripe Connect v2 loss-liability",
      "Runtime query plans",
      "Provider-side privacy erasure",
      "Cross-seller AI duplicate detection",
      "Durable checkout-group semantics",
      "High-scale BigInt and counters",
      "Historical shipping-rate currency drift",
      "Clerk staff/security controls",
      "Buyer-deletion Stripe replay proof",
      "Founding Maker concurrency",
      "Sentry cron alerting",
      "Cloudflare R2 posture and smoke",
      "HSTS preload",
      "Vercel Analytics and Speed Insights",
      "Homepage browser a11y/runtime proof",
      "Deployed security headers",
    ];

    for (const category of requiredCategories) {
      assert.match(backlog, new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("keeps future-agent and launch docs linked to the backlog", () => {
    assert.match(source("CLAUDE.md"), /docs\/deferred-launch-backlog\.md/);
    assert.match(source("docs/launch-checklist.md"), /docs\/deferred-launch-backlog\.md/);
  });
});

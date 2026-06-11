import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("public security configuration guardrails", () => {
  it("keeps browser source maps disabled in production config", () => {
    const config = source("next.config.ts");

    assert.match(config, /productionBrowserSourceMaps:\s*false/);
  });

  it("keeps enforced script CSP off unsafe eval", () => {
    const config = source("next.config.ts");

    assert.match(config, /script-src 'self' 'unsafe-inline' https:\/\/clerk\.thegrainline\.com/);
    assert.doesNotMatch(config, /'unsafe-eval'/);
  });

  it("keeps retired third-party image hosts out of CSP", () => {
    const config = source("next.config.ts");

    assert.doesNotMatch(config, /i\.postimg\.cc/);
  });

  it("keeps sensitive signed-in routes disallowed in robots.txt", () => {
    const route = source("src/app/robots.txt/route.ts");

    for (const path of ["/dashboard", "/admin", "/account", "/messages", "/cart", "/checkout", "/api"]) {
      assert.match(route, new RegExp(`Disallow: ${path.replace("/", "\\/")}`));
    }
  });

  it("keeps private founder inbox details out of tracked agent docs", () => {
    const docs = source("CLAUDE.md");

    assert.doesNotMatch(docs, /drewyoung910@gmail\.com/);
    assert.doesNotMatch(docs, /258 Roehl Rd/);
  });

  it("keeps production env documentation aligned with required runtime secrets", () => {
    const docs = source("CLAUDE.md");
    const launch = source("docs/launch-checklist.md");

    for (const name of [
      "NEXT_PUBLIC_APP_URL",
      "DATABASE_URL",
      "DIRECT_URL",
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "CLERK_SECRET_KEY",
      "STRIPE_SECRET_KEY",
      "SHIPPING_RATE_SECRET",
      "CRON_SECRET",
      "SENTRY_AUTH_TOKEN",
    ]) {
      assert.match(docs, new RegExp(`\`${name}\``));
      assert.match(launch, new RegExp(`- \`${name}\``));
    }
  });

  it("documents Vercel geo header trust and staged database-role hardening", () => {
    const architecture = source("docs/architecture.md");
    const middleware = source("src/middleware.ts");
    const hardeningPlan = source("docs/security-hardening-plan.md");

    assert.match(middleware, /x-vercel-ip-country/);
    assert.match(middleware, /only trusted behind\s+\/\/ Vercel's managed ingress/);
    assert.match(architecture, /`x-vercel-ip-country`/);
    assert.match(architecture, /Vercel managed ingress/);
    assert.match(hardeningPlan, /least-privilege runtime database role/);
    assert.match(hardeningPlan, /post-launch hardening/);
    assert.match(hardeningPlan, /Keep `DATABASE_URL` on a pooled runtime role/);
    assert.match(hardeningPlan, /keep `DIRECT_URL` on the migration owner role/);
  });

  it("keeps refund panel docs on the current orderTotalCents prop", () => {
    const docs = source("CLAUDE.md");

    assert.match(docs, /`SellerRefundPanel` now accepts `orderTotalCents`/);
    assert.doesNotMatch(docs, /`SellerRefundPanel` now accepts `maxRefundCents`/);
  });
});

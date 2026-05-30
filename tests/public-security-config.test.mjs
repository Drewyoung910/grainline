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
    }
  });

  it("keeps refund panel docs on the current orderTotalCents prop", () => {
    const docs = source("CLAUDE.md");

    assert.match(docs, /`SellerRefundPanel` now accepts `orderTotalCents`/);
    assert.doesNotMatch(docs, /`SellerRefundPanel` now accepts `maxRefundCents`/);
  });
});

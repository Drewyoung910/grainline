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

  it("keeps the global security header set enforced on every route", () => {
    const config = source("next.config.ts");

    for (const [key, value] of [
      ["X-DNS-Prefetch-Control", "on"],
      ["X-Frame-Options", "SAMEORIGIN"],
      ["X-Content-Type-Options", "nosniff"],
      ["Referrer-Policy", "strict-origin-when-cross-origin"],
      ["Cross-Origin-Opener-Policy", "same-origin-allow-popups"],
      ["Cross-Origin-Resource-Policy", "same-site"],
      ["Permissions-Policy", "camera=(), microphone=(), geolocation=(self)"],
      ["Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload"],
      ["Content-Security-Policy", null],
    ]) {
      assert.match(config, new RegExp(`key: "${key}"`));
      if (value) assert.match(config, new RegExp(`value: "${value.replace(/[()]/g, "\\$&")}"`));
    }

    assert.match(config, /key: "Reporting-Endpoints", value: 'csp-endpoint="\/api\/csp-report"'/);
    assert.match(config, /source: "\/\(\.\*\)"/);
    assert.match(config, /headers: securityHeaders/);
    assert.doesNotMatch(config, /Content-Security-Policy-Report-Only/);
  });

  it("keeps core CSP directives and reporting in the enforced policy", () => {
    const config = source("next.config.ts");

    for (const directive of [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "script-src-elem 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-src 'self'",
      "worker-src 'self' blob:",
      "media-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "report-to csp-endpoint",
      "report-uri /api/csp-report",
    ]) {
      assert.match(config, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    assert.equal(config.includes("script-src *"), false);
    assert.equal(config.includes("frame-src *"), false);
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

  it("keeps durable security docs aligned with current geo, CSP, and Stripe status", () => {
    const docs = source("CLAUDE.md");
    const config = source("next.config.ts");

    assert.match(docs, /`x-vercel-ip-country`/);
    assert.match(docs, /Do not reintroduce an all-`\/api` bypass/);
    assert.doesNotMatch(docs, /request\.geo\?\.country/);
    assert.match(docs, /Apple Pay domain registration is complete/);
    assert.match(docs, /legacy UploadThing\/UTFS origins/);
    assert.match(config, /media-src 'self' \$\{r2PublicOrigins\} \$\{r2ApiOrigin\} https:\/\/utfs\.io/);
  });

  it("keeps refund panel docs on the current orderTotalCents prop", () => {
    const docs = source("CLAUDE.md");

    assert.match(docs, /`SellerRefundPanel` now accepts `orderTotalCents`/);
    assert.doesNotMatch(docs, /`SellerRefundPanel` now accepts `maxRefundCents`/);
  });

  it("keeps env docs from recommending non-null assertions on secrets", () => {
    const docs = source("CLAUDE.md");

    assert.match(docs, /requiredProductionEnv\("DATABASE_URL"\)/);
    assert.doesNotMatch(docs, /process\.env\.DATABASE_URL!/);
    assert.doesNotMatch(docs, /new PrismaPg\(\{ connectionString: process\.env\.[A-Z0-9_]+/);
  });
});

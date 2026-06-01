import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function maxDurationFor(path) {
  const text = source(path);
  const match = text.match(/export const maxDuration = (\d+)/);
  assert.ok(match, `${path} must export a route-level maxDuration`);
  return Number(match[1]);
}

describe("route maxDuration guardrails", () => {
  it("keeps long-running payment and shipping routes above the platform default", () => {
    const routes = {
      "src/app/api/cart/checkout-seller/route.ts": 60,
      "src/app/api/cart/checkout/single/route.ts": 60,
      "src/app/api/cart/checkout/rollback/route.ts": 60,
      "src/app/api/stripe/webhook/route.ts": 60,
      "src/app/api/stripe/webhook/v2/route.ts": 30,
      "src/app/api/orders/[id]/label/route.ts": 60,
      "src/app/api/orders/[id]/refund/route.ts": 60,
      "src/app/api/orders/[id]/fulfillment/route.ts": 30,
      "src/app/api/cases/[id]/resolve/route.ts": 60,
      "src/app/api/shipping/quote/route.ts": 30,
      "src/app/api/upload/image/route.ts": 60,
    };

    for (const [path, expected] of Object.entries(routes)) {
      assert.equal(maxDurationFor(path), expected, path);
    }
  });

  it("keeps every registered cron route on an explicit maxDuration", () => {
    const config = JSON.parse(source("vercel.json"));

    for (const cron of config.crons) {
      const routePath = `src/app${cron.path}/route.ts`;
      const duration = maxDurationFor(routePath);
      assert.ok(duration >= 60, `${routePath} should not use the 10s default`);
    }
  });
});

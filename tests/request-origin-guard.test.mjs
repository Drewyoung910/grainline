import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  getExplicitCrossOriginPostRejection,
} = await import("../src/lib/requestOriginGuard.ts");

function routeSource(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("request origin guard", () => {
  it("rejects explicit cross-origin browser POST headers", () => {
    assert.deepEqual(
      getExplicitCrossOriginPostRejection(new Request("https://thegrainline.com/api/orders/o_1/fulfillment", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      })),
      { header: "origin", value: "https://evil.test", expectedOrigin: "https://thegrainline.com" },
    );

    assert.deepEqual(
      getExplicitCrossOriginPostRejection(new Request("https://thegrainline.com/api/orders/o_1/fulfillment", {
        method: "POST",
        headers: { referer: "https://evil.test/post" },
      })),
      { header: "referer", value: "https://evil.test/post", expectedOrigin: "https://thegrainline.com" },
    );

    assert.deepEqual(
      getExplicitCrossOriginPostRejection(new Request("https://thegrainline.com/api/orders/o_1/fulfillment", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      })),
      { header: "sec-fetch-site", value: "cross-site", expectedOrigin: "https://thegrainline.com" },
    );
  });

  it("allows same-origin and absent origin headers", () => {
    assert.equal(
      getExplicitCrossOriginPostRejection(new Request("https://thegrainline.com/api/orders/o_1/fulfillment", {
        method: "POST",
        headers: { origin: "https://thegrainline.com", referer: "https://thegrainline.com/dashboard" },
      })),
      null,
    );
    assert.equal(
      getExplicitCrossOriginPostRejection(new Request("https://thegrainline.com/api/orders/o_1/fulfillment", {
        method: "POST",
      })),
      null,
    );
  });

  it("checks order mutation POST origins before parsing or mutation work", () => {
    const fulfillment = routeSource("src/app/api/orders/[id]/fulfillment/route.ts");
    const fulfillmentGuardIndex = fulfillment.indexOf("getExplicitCrossOriginPostRejection(req)");

    assert.ok(fulfillmentGuardIndex > -1);
    assert.ok(fulfillmentGuardIndex < fulfillment.indexOf("await auth()"));
    assert.ok(fulfillmentGuardIndex < fulfillment.indexOf("await req.formData()"));
    assert.ok(fulfillmentGuardIndex < fulfillment.indexOf("prisma.order.updateMany"));

    const confirmDelivery = routeSource("src/app/api/orders/[id]/confirm-delivery/route.ts");
    const confirmGuardIndex = confirmDelivery.indexOf("getExplicitCrossOriginPostRejection(req)");

    assert.ok(confirmGuardIndex > -1);
    assert.ok(confirmGuardIndex < confirmDelivery.indexOf("await auth()"));
    assert.ok(confirmGuardIndex < confirmDelivery.indexOf("safeRateLimit("));
    assert.ok(confirmGuardIndex < confirmDelivery.indexOf("prisma.order.findUnique"));
    assert.ok(confirmGuardIndex < confirmDelivery.indexOf("prisma.order.updateMany"));
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  getExplicitCrossOriginPostRejection,
} = await import("../src/lib/requestOriginGuard.ts");

function fulfillmentRouteSource() {
  return readFileSync(new URL("../src/app/api/orders/[id]/fulfillment/route.ts", import.meta.url), "utf8");
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

  it("checks fulfillment form POST origin before form parsing or mutation work", () => {
    const route = fulfillmentRouteSource();
    const guardIndex = route.indexOf("getExplicitCrossOriginPostRejection(req)");

    assert.ok(guardIndex > -1);
    assert.ok(guardIndex < route.indexOf("await auth()"));
    assert.ok(guardIndex < route.indexOf("await req.formData()"));
    assert.ok(guardIndex < route.indexOf("prisma.order.updateMany"));
  });
});

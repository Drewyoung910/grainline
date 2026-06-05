import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { caseStatusLabel } = await import("../src/lib/caseLabels.ts");
const { fulfillmentStatusLabel } = await import("../src/lib/fulfillmentLabels.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("status label guardrails", () => {
  it("keeps case status labels centralized", () => {
    assert.equal(caseStatusLabel("OPEN"), "Open");
    assert.equal(caseStatusLabel("IN_DISCUSSION"), "In Discussion");
    assert.equal(caseStatusLabel("PENDING_CLOSE"), "Awaiting Resolution");
    assert.equal(caseStatusLabel("UNDER_REVIEW"), "Under Review");

    for (const path of [
      "src/app/admin/cases/page.tsx",
      "src/app/admin/cases/[id]/page.tsx",
    ]) {
      const text = source(path);
      assert.match(text, /caseStatusLabel/);
      assert.doesNotMatch(text, /status\.replaceAll\("_", " "\)/);
    }
  });

  it("keeps fulfillment status labels centralized across order surfaces", () => {
    assert.equal(fulfillmentStatusLabel("PENDING"), "Pending");
    assert.equal(fulfillmentStatusLabel("READY_FOR_PICKUP"), "Ready for Pickup");
    assert.equal(fulfillmentStatusLabel("PICKED_UP"), "Picked Up");
    assert.equal(fulfillmentStatusLabel("SHIPPED"), "Shipped");
    assert.equal(fulfillmentStatusLabel("DELIVERED"), "Delivered");
    assert.equal(fulfillmentStatusLabel(null), "Pending");

    for (const path of [
      "src/app/admin/orders/page.tsx",
      "src/app/admin/orders/[id]/page.tsx",
      "src/app/dashboard/orders/[id]/page.tsx",
      "src/app/dashboard/sales/[orderId]/page.tsx",
      "src/app/dashboard/sales/page.tsx",
    ]) {
      const text = source(path);
      assert.match(text, /fulfillmentStatusLabel/);
      assert.doesNotMatch(text, /fulfillmentStatus[^\n]*\.replaceAll\("_", " "\)/);
      assert.doesNotMatch(text, /status\.replaceAll\("_", " "\)/);
    }
  });
});

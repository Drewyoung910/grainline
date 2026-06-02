import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  CASE_WINDOW_DAYS,
  caseEstimatedDeliveryBlockMessage,
  caseWindowClosedMessage,
  caseWindowClosesAt,
  caseWindowReferenceDate,
  isOrderCaseWindowClosed,
} = await import("../src/lib/caseCreateState.ts");
const route = readFileSync("src/app/api/cases/route.ts", "utf8");
const buyerOrderPage = readFileSync("src/app/dashboard/orders/[id]/page.tsx", "utf8");

describe("case create state", () => {
  it("includes the estimated delivery date in early case-block errors", () => {
    assert.equal(
      caseEstimatedDeliveryBlockMessage(new Date("2026-05-12T16:30:00.000Z")),
      "You can open a case after the estimated delivery date (May 12, 2026) if the order still has not arrived.",
    );
  });

  it("uses a shared 30-day case window from the current delivery reference date", () => {
    assert.equal(CASE_WINDOW_DAYS, 30);

    const estimatedOnlyOrder = {
      fulfillmentStatus: "SHIPPED",
      estimatedDeliveryDate: "2026-05-01T12:00:00.000Z",
    };
    assert.equal(
      caseWindowReferenceDate(estimatedOnlyOrder)?.toISOString(),
      "2026-05-01T12:00:00.000Z",
    );
    assert.equal(
      caseWindowClosesAt(estimatedOnlyOrder)?.toISOString(),
      "2026-05-31T12:00:00.000Z",
    );
    assert.equal(isOrderCaseWindowClosed(estimatedOnlyOrder, new Date("2026-05-30T12:00:00.000Z")), false);
    assert.equal(isOrderCaseWindowClosed(estimatedOnlyOrder, new Date("2026-06-01T12:00:00.000Z")), true);

    const deliveredOrder = {
      fulfillmentStatus: "DELIVERED",
      estimatedDeliveryDate: "2026-05-01T12:00:00.000Z",
      deliveredAt: "2026-05-04T12:00:00.000Z",
    };
    assert.equal(
      caseWindowReferenceDate(deliveredOrder)?.toISOString(),
      "2026-05-04T12:00:00.000Z",
    );

    const pickedUpOrder = {
      fulfillmentStatus: "PICKED_UP",
      estimatedDeliveryDate: "2026-05-01T12:00:00.000Z",
      pickedUpAt: "2026-05-03T12:00:00.000Z",
    };
    assert.equal(
      caseWindowReferenceDate(pickedUpOrder)?.toISOString(),
      "2026-05-03T12:00:00.000Z",
    );

    assert.equal(
      caseWindowClosedMessage(new Date("2026-05-31T12:00:00.000Z")),
      "The case window for this order closed on May 31, 2026.",
    );
  });

  it("returns a friendly conflict for duplicate case creation races", () => {
    assert.match(route, /\(err as \{ code\?: string \}\)\.code === "P2002"/);
    assert.match(route, /A case is already open for this order\./);
    assert.match(route, /status: 409/);
  });

  it("enforces the shared case window in the API route and buyer order page", () => {
    assert.match(route, /isOrderCaseWindowClosed\(order, now\)/);
    assert.match(route, /caseWindowClosedMessage\(caseWindowClosesAt\(order\)\)/);

    assert.match(buyerOrderPage, /const caseWindowClosed = isOrderCaseWindowClosed\(order, now\)/);
    assert.match(buyerOrderPage, /!caseWindowClosed/);
    assert.match(buyerOrderPage, /!hasRefund/);
    assert.match(buyerOrderPage, /caseWindowClosedMessage\(caseWindowClosedAt\)/);
  });
});

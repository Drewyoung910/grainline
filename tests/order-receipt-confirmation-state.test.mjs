import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { orderReceiptConfirmationTransition } from "../src/lib/orderReceiptConfirmationState.ts";

describe("Order receipt confirmation state", () => {
  it("lets a buyer confirm a shipped Order as delivered", () => {
    assert.deepEqual(
      orderReceiptConfirmationTransition({
        fulfillmentMethod: "SHIPPING",
        fulfillmentStatus: "SHIPPED",
      }),
      {
        fulfillmentMethod: "SHIPPING",
        previousStatus: "SHIPPED",
        newStatus: "DELIVERED",
        timestampField: "deliveredAt",
      },
    );
  });

  it("retains null-method compatibility only for historical shipped Orders", () => {
    assert.equal(
      orderReceiptConfirmationTransition({
        fulfillmentMethod: null,
        fulfillmentStatus: "SHIPPED",
      })?.newStatus,
      "DELIVERED",
    );
    assert.equal(
      orderReceiptConfirmationTransition({
        fulfillmentMethod: null,
        fulfillmentStatus: "READY_FOR_PICKUP",
      }),
      null,
    );
  });

  it("lets a buyer, not a seller, confirm ready-for-pickup handoff", () => {
    assert.deepEqual(
      orderReceiptConfirmationTransition({
        fulfillmentMethod: "PICKUP",
        fulfillmentStatus: "READY_FOR_PICKUP",
      }),
      {
        fulfillmentMethod: "PICKUP",
        previousStatus: "READY_FOR_PICKUP",
        newStatus: "PICKED_UP",
        timestampField: "pickedUpAt",
      },
    );
  });

  it("rejects method mismatches and every non-receivable state", () => {
    for (const input of [
      { fulfillmentMethod: "PICKUP", fulfillmentStatus: "SHIPPED" },
      { fulfillmentMethod: "SHIPPING", fulfillmentStatus: "READY_FOR_PICKUP" },
      { fulfillmentMethod: "SHIPPING", fulfillmentStatus: "PENDING" },
      { fulfillmentMethod: "PICKUP", fulfillmentStatus: "PICKED_UP" },
      { fulfillmentMethod: "SHIPPING", fulfillmentStatus: "DELIVERED" },
    ]) {
      assert.equal(orderReceiptConfirmationTransition(input), null);
    }
  });
});

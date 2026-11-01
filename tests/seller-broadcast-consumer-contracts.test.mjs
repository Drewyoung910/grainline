import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSellerBroadcastConsumerContracts,
  sellerBroadcastConsumerInventory,
} from "../scripts/seller-broadcast-consumer-contracts.mjs";

describe("SellerBroadcast pre-RLS consumer contracts", () => {
  it("pins all 16 direct operations in six reviewed source files", () => {
    const inventory = assertSellerBroadcastConsumerContracts();
    assert.equal(Object.keys(inventory.directCallers).length, 6);
    assert.equal(
      Object.values(inventory.directCallers).reduce(
        (count, operations) => count + operations.length,
        0,
      ),
      16,
    );
  });

  it("finds no direct raw SQL caller outside reviewed fixed authorities", () => {
    assert.deepEqual(sellerBroadcastConsumerInventory().rawSqlCallers, []);
  });
});


import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminAuditLogConsumerInventory,
  assertAdminAuditLogConsumerContracts,
} from "../scripts/admin-audit-log-consumer-contracts.mjs";

describe("AdminAuditLog pre-RLS consumer contracts", () => {
  it("pins every current direct delegate operation until conversion reaches zero", () => {
    const inventory = assertAdminAuditLogConsumerContracts();
    assert.equal(Object.keys(inventory.directCallers).length, 6);
    assert.equal(
      Object.values(inventory.directCallers).reduce(
        (count, operations) => count + operations.length,
        0,
      ),
      19,
    );
  });

  it("pins the one current direct raw SQL caller", () => {
    assert.deepEqual(adminAuditLogConsumerInventory().rawSqlCallers, [
      "src/lib/accountDeletion.ts",
    ]);
  });
});

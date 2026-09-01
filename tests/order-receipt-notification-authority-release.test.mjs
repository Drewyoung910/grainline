import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ORDER_RECEIPT_NOTIFICATION_AUTHORITY_MIGRATION_SHA256,
  verifyOrderReceiptNotificationAuthorityMigrationBytes,
} from "../scripts/order-receipt-notification-authority-catalog.mjs";

const migrationPath =
  "prisma/migrations/20260901120000_prepare_order_receipt_notification_authority/migration.sql";
const migration = readFileSync(migrationPath, "utf8");
const predecessor = readFileSync(
  "prisma/migrations/20260825010000_prepare_blocked_checkout_refund_delivery/migration.sql",
  "utf8",
);

describe("Order receipt Notification authority release", () => {
  it("is reproducible from the promoted predecessor and byte pinned", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/build-order-receipt-notification-authority.mjs", "--verify"],
      { encoding: "utf8" },
    );
    const result = JSON.parse(output);
    assert.equal(result.sha256, ORDER_RECEIPT_NOTIFICATION_AUTHORITY_MIGRATION_SHA256);
    assert.equal(
      crypto.createHash("sha256").update(migration).digest("hex"),
      result.sha256,
    );
    assert.equal(
      verifyOrderReceiptNotificationAuthorityMigrationBytes().migrationSha256,
      result.sha256,
    );
  });

  it("changes only the private core and preserves RLS/table grants", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.grainline_notification_create_core/);
    assert.match(migration, /source_seller\.id = source_order\."sellerProfileId"/);
    assert.match(migration, /source_audit\."actorId" = source_order\."buyerId"/);
    assert.match(migration, /WHEN 'delivered' THEN 'Buyer confirmed delivery'/);
    assert.doesNotMatch(migration, /ALTER TABLE|GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON TABLE/);
    assert.doesNotMatch(migration, /CREATE POLICY|DROP POLICY|ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_notification_create_core[\s\S]*FROM PUBLIC, grainline_app_runtime/);
    assert.match(predecessor, /WHEN 'picked_up' THEN 'Order picked up!'/);
    assert.doesNotMatch(predecessor, /WHEN 'delivered' THEN 'Buyer confirmed delivery'/);
  });
});

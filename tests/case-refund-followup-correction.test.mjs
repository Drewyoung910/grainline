import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCaseRefundFollowupCorrection,
  CASE_REFUND_FOLLOWUP_MIGRATION,
} from "../scripts/build-case-refund-followup-correction.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const followupMigrationPath =
  process.env.CASE_REFUND_FOLLOWUP_MIGRATION_PATH?.trim() ||
  path.join(
    root,
    "prisma/migrations",
    CASE_REFUND_FOLLOWUP_MIGRATION,
    "migration.sql",
  );
const authorityPath = path.join(
  root,
  "src/lib/caseStaffResolutionAuthority.ts",
);
const inventoryPath = path.join(
  root,
  "scripts/case-refund-710-production-inventory.sql",
);

test("Case refund follow-up migration is generated from pinned predecessors", () => {
  const migration = fs.readFileSync(
    followupMigrationPath,
    "utf8",
  );
  assert.equal(migration, buildCaseRefundFollowupCorrection(root));
});

test("Case refund follow-up keeps high-risk changes inside fixed authorities", () => {
  const migration = buildCaseRefundFollowupCorrection(root);
  assert.match(migration, /pendingLocalRefundLock/u);
  assert.match(migration, /caseResolutionClaimId/u);
  assert.match(migration, /skippedStockRestoreCount/u);
  assert.match(
    migration,
    /REPAIR_CASE_REFUND_RECONCILIATION_MARKER/u,
  );
  assert.doesNotMatch(migration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)/iu);
  assert.doesNotMatch(migration, /ALTER\s+TABLE/iu);
});

test("Case finalization stays compatible before the follow-up migration", () => {
  const authority = fs.readFileSync(authorityPath, "utf8");
  assert.match(
    authority,
    /skippedStockRestoreCount:\s*row\.skippedStockRestoreCount == null\s*\? 0\s*:\s*requireInteger\(/u,
  );
});

test("#710 Production inventory is aggregate and read-only", () => {
  const inventory = fs.readFileSync(inventoryPath, "utf8");
  assert.match(
    inventory,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/u,
  );
  assert.match(inventory, /pendingLocalRefundLock' = 'false'/u);
  assert.match(inventory, /refund_event\."createdAt" >= claim\."createdAt"/u);
  assert.match(inventory, /AS repairable_claims/u);
  assert.match(inventory, /AS unrepairable_claims/u);
  assert.match(inventory, /FILTER \(WHERE NOT stuck\.repairable\)/u);
  assert.doesNotMatch(
    inventory,
    /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/iu,
  );
});

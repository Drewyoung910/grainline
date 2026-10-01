#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_ITEM_DIRECT_FUNCTIONS,
  ORDER_ITEM_TRIGGER_FUNCTIONS,
  ORDER_ITEM_TRIGGER_SOURCE_MD5,
  orderChildSourceFunctionCatalog,
} from "./order-child-authority-catalog.mjs";

const DRAFT_HEADER = "-- DRAFT ONLY. Do not apply to any persistent database.";
const RELEASE_HEADER = "-- Reviewed policyless OrderItem ENABLE and zero-direct authority retention.\n-- Apply only through the guarded main-only production migration workflow.";
const DEFAULT_MIGRATION_PATH =
  "prisma/migrations/20261001030000_enable_order_item_rls/migration.sql";
const migrationPath =
  process.env.ORDER_ITEM_ENABLE_MIGRATION_PATH?.trim() || DEFAULT_MIGRATION_PATH;

export const ORDER_ITEM_ENABLE_RELEASE = Object.freeze({
  migrationName: "20261001030000_enable_order_item_rls",
  draftPath: "docs/rls-drafts/order-item-activation.sql",
  rollbackPath: "docs/rls-drafts/order-item-activation-rollback.sql",
  migrationPath,
  draftSha256: "82e43152a3b9da2636853efde9ec3ef84ca42ac9f271718ca16541f23149a09b",
  rollbackSha256: "5050ee096a4902945f70463f14677e569d18cd9b530e3b3b727f83b5792a7387",
  migrationSha256: "512e0ba83cc06236618a6709015c77bf47519431917f4f393951a8694c17f520",
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const count = (value, pattern) => (value.match(pattern) ?? []).length;

function readPinned(rootDirectory, relativePath, expectedSha256) {
  const sourcePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(rootDirectory, relativePath);
  const value = fs.readFileSync(sourcePath, "utf8");
  assert.equal(sha256(value), expectedSha256, `${relativePath} bytes drifted`);
  return value;
}

export function buildOrderItemRlsCandidate(rootDirectory = process.cwd()) {
  const draft = readPinned(
    rootDirectory,
    ORDER_ITEM_ENABLE_RELEASE.draftPath,
    ORDER_ITEM_ENABLE_RELEASE.draftSha256,
  );
  const rollback = readPinned(
    rootDirectory,
    ORDER_ITEM_ENABLE_RELEASE.rollbackPath,
    ORDER_ITEM_ENABLE_RELEASE.rollbackSha256,
  );
  const migration = readPinned(
    rootDirectory,
    ORDER_ITEM_ENABLE_RELEASE.migrationPath,
    ORDER_ITEM_ENABLE_RELEASE.migrationSha256,
  );
  assert.ok(draft.startsWith(`${DRAFT_HEADER}\n`));
  assert.ok(rollback.startsWith(`${DRAFT_HEADER}\n`));
  assert.equal(draft.replace(DRAFT_HEADER, RELEASE_HEADER), migration);

  for (const source of [draft, rollback, migration]) {
    assert.equal(count(source, /^BEGIN;$/gmu), 1);
    assert.equal(count(source, /^COMMIT;$/gmu), 1);
    assert.doesNotMatch(source, /\b(?:CREATE|DROP)\s+POLICY\b/iu);
    assert.doesNotMatch(
      source,
      /^ALTER TABLE public\."(?:Order|OrderShippingRateQuote)"/gmu,
    );
  }
  assert.equal(
    count(draft, /^ALTER TABLE public\."OrderItem" ENABLE ROW LEVEL SECURITY;$/gmu),
    1,
  );
  assert.equal(
    count(draft, /^ALTER TABLE public\."OrderItem" NO FORCE ROW LEVEL SECURITY;$/gmu),
    1,
  );
  assert.equal(
    count(rollback, /^ALTER TABLE public\."OrderItem" DISABLE ROW LEVEL SECURITY;$/gmu),
    1,
  );
  assert.doesNotMatch(draft, /^ALTER TABLE public\."OrderItem" FORCE ROW LEVEL SECURITY;$/gmu);
  assert.doesNotMatch(rollback, /\bGRANT\b/iu);
  assert.match(
    draft,
    /^REVOKE ALL ON TABLE public\."OrderItem"\s+FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;$/gmu,
  );

  const sourceCatalog = orderChildSourceFunctionCatalog(rootDirectory)
    .filter((entry) => entry.touchesOrderItem);
  assert.equal(sourceCatalog.length, ORDER_ITEM_DIRECT_FUNCTIONS.length);
  assert.deepEqual(
    sourceCatalog.map((entry) => entry.name).sort(),
    [...ORDER_ITEM_DIRECT_FUNCTIONS],
  );
  for (const entry of sourceCatalog) {
    assert.ok(
      draft.includes(`('${entry.identity.replaceAll("'", "''")}', '${entry.sourceMd5}')`),
      `${entry.identity} is missing from the ENABLE preflight`,
    );
  }
  for (const trigger of ORDER_ITEM_TRIGGER_FUNCTIONS) {
    assert.ok(draft.includes(`trigger_row.tgname = '${trigger}'`));
    assert.ok(draft.includes(`pg_catalog.md5(procedure.prosrc) = '${ORDER_ITEM_TRIGGER_SOURCE_MD5[trigger]}'`));
  }

  return Object.freeze({
    draft,
    rollback,
    migration,
    ...ORDER_ITEM_ENABLE_RELEASE,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2 && (process.argv.length !== 3 || process.argv[2] !== "--verify")) {
    throw new Error("usage: build-order-item-rls-candidate.mjs [--verify]");
  }
  const release = buildOrderItemRlsCandidate();
  process.stdout.write(`${JSON.stringify({
    mode: "review-only",
    migrationTreeWritten: false,
    migrationName: release.migrationName,
    migrationSha256: release.migrationSha256,
    rollbackSha256: release.rollbackSha256,
    orderItemDirectFunctionCount: ORDER_ITEM_DIRECT_FUNCTIONS.length,
    orderItemTriggerCount: ORDER_ITEM_TRIGGER_FUNCTIONS.length,
  })}\n`);
}

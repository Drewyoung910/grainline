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
const RELEASE_HEADER = "-- Reviewed policyless OrderItem FORCE hardening.\n-- Apply only through the guarded main-only production migration workflow.";
const DEFAULT_MIGRATION_PATH =
  "prisma/migrations/20261001040000_force_order_item_rls/migration.sql";
const migrationPath =
  process.env.ORDER_ITEM_FORCE_MIGRATION_PATH?.trim() || DEFAULT_MIGRATION_PATH;

export const ORDER_ITEM_FORCE_RELEASE = Object.freeze({
  migrationName: "20261001040000_force_order_item_rls",
  draftPath: "docs/rls-drafts/order-item-force.sql",
  rollbackPath: "docs/rls-drafts/order-item-force-rollback.sql",
  migrationPath,
  draftSha256: "cb5ba5c25707bc8f479e5813416c08638ae0cbf1c8cf093a649bbe52860cebdb",
  rollbackSha256: "e4720c564f4d54bae28d133a337e270e734de57e47e08a833ca7e0228a5ae3a7",
  migrationSha256: "c741c53d20d5f6dc55c9b29e55d5c0ecf7a69b1d0e052c41b81279f37aeecac9",
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

export function buildOrderItemForceCandidate(rootDirectory = process.cwd()) {
  const draft = readPinned(
    rootDirectory,
    ORDER_ITEM_FORCE_RELEASE.draftPath,
    ORDER_ITEM_FORCE_RELEASE.draftSha256,
  );
  const rollback = readPinned(
    rootDirectory,
    ORDER_ITEM_FORCE_RELEASE.rollbackPath,
    ORDER_ITEM_FORCE_RELEASE.rollbackSha256,
  );
  const migration = readPinned(
    rootDirectory,
    ORDER_ITEM_FORCE_RELEASE.migrationPath,
    ORDER_ITEM_FORCE_RELEASE.migrationSha256,
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
    count(draft, /^ALTER TABLE public\."OrderItem" FORCE ROW LEVEL SECURITY;$/gmu),
    1,
  );
  assert.equal(
    count(rollback, /^ALTER TABLE public\."OrderItem" NO FORCE ROW LEVEL SECURITY;$/gmu),
    1,
  );
  assert.doesNotMatch(draft, /^ALTER TABLE public\."OrderItem" (?:ENABLE|NO FORCE) ROW LEVEL SECURITY;$/gmu);
  assert.doesNotMatch(rollback, /^ALTER TABLE public\."OrderItem" DISABLE ROW LEVEL SECURITY;$/gmu);
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
    assert.equal(entry.securityDefiner, true, `${entry.identity} source is not SECURITY DEFINER`);
    assert.equal(entry.leakproof, false, `${entry.identity} source became leakproof`);
    const expectedRow = [
      entry.identity,
      entry.sourceMd5,
      entry.languageName,
      entry.volatility,
      entry.parallelSafety,
    ].map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
    assert.ok(
      draft.includes(`(${expectedRow})`),
      `${entry.identity} is missing from the FORCE preflight`,
    );
  }
  assert.equal(sourceCatalog.filter((entry) => entry.languageName === "sql").length, 4);
  assert.equal(sourceCatalog.filter((entry) => entry.languageName === "plpgsql").length, 30);
  assert.doesNotMatch(draft, /actual\.lanname = 'plpgsql'/u);
  for (const trigger of ORDER_ITEM_TRIGGER_FUNCTIONS) {
    assert.ok(draft.includes(`trigger_row.tgname = '${trigger}'`));
    assert.ok(draft.includes(`pg_catalog.md5(procedure.prosrc) = '${ORDER_ITEM_TRIGGER_SOURCE_MD5[trigger]}'`));
  }

  return Object.freeze({
    draft,
    rollback,
    migration,
    ...ORDER_ITEM_FORCE_RELEASE,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2 && (process.argv.length !== 3 || process.argv[2] !== "--verify")) {
    throw new Error("usage: build-order-item-force-candidate.mjs [--verify]");
  }
  const release = buildOrderItemForceCandidate();
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

#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_QUOTE_DIRECT_FUNCTIONS,
  orderChildSourceFunctionCatalog,
} from "./order-child-authority-catalog.mjs";

const DRAFT_HEADER = "-- DRAFT ONLY. Do not apply to any persistent database.";
const RELEASE_HEADER = "-- Reviewed policyless OrderShippingRateQuote ENABLE and zero-direct authority retention.\n-- Apply only through the guarded main-only production migration workflow.";
const DEFAULT_MIGRATION_PATH =
  "prisma/migrations/20261001050000_enable_order_shipping_rate_quote_rls/migration.sql";
const migrationPath =
  process.env.ORDER_QUOTE_ENABLE_MIGRATION_PATH?.trim() || DEFAULT_MIGRATION_PATH;

export const ORDER_QUOTE_ENABLE_RELEASE = Object.freeze({
  migrationName: "20261001050000_enable_order_shipping_rate_quote_rls",
  draftPath: "docs/rls-drafts/order-shipping-rate-quote-activation.sql",
  rollbackPath:
    "docs/rls-drafts/order-shipping-rate-quote-activation-rollback.sql",
  migrationPath,
  draftSha256:
    "4e2a274d9bc7d2c560da11c06af1dcf1f7298fe17535651c72337bf13151c3d0",
  rollbackSha256:
    "0cde0551f51e9350e81521246cdb6619bab4b1abf7e8b5543012f80f6ad4cc1e",
  migrationSha256:
    "450e4c100b1711139b165765b6a170accf515abad7d14a141cbb95621b1fcbd4",
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

export function buildOrderQuoteRlsCandidate(rootDirectory = process.cwd()) {
  const draft = readPinned(
    rootDirectory,
    ORDER_QUOTE_ENABLE_RELEASE.draftPath,
    ORDER_QUOTE_ENABLE_RELEASE.draftSha256,
  );
  const rollback = readPinned(
    rootDirectory,
    ORDER_QUOTE_ENABLE_RELEASE.rollbackPath,
    ORDER_QUOTE_ENABLE_RELEASE.rollbackSha256,
  );
  const migration = readPinned(
    rootDirectory,
    ORDER_QUOTE_ENABLE_RELEASE.migrationPath,
    ORDER_QUOTE_ENABLE_RELEASE.migrationSha256,
  );
  assert.equal(draft.replace(DRAFT_HEADER, RELEASE_HEADER), migration);

  assert.ok(draft.startsWith(`${DRAFT_HEADER}\n`));
  assert.ok(rollback.startsWith(`${DRAFT_HEADER}\n`));
  for (const source of [draft, rollback, migration]) {
    assert.equal(count(source, /^BEGIN;$/gmu), 1);
    assert.equal(count(source, /^COMMIT;$/gmu), 1);
    assert.doesNotMatch(source, /\b(?:CREATE|DROP)\s+POLICY\b/iu);
    assert.doesNotMatch(
      source,
      /^ALTER TABLE public\."(?:Order|OrderItem)"/gmu,
    );
  }
  assert.equal(
    count(
      draft,
      /^ALTER TABLE public\."OrderShippingRateQuote" ENABLE ROW LEVEL SECURITY;$/gmu,
    ),
    1,
  );
  assert.equal(
    count(
      draft,
      /^ALTER TABLE public\."OrderShippingRateQuote" NO FORCE ROW LEVEL SECURITY;$/gmu,
    ),
    1,
  );
  assert.doesNotMatch(
    migration,
    /^ALTER TABLE public\."OrderShippingRateQuote" FORCE ROW LEVEL SECURITY;$/gmu,
  );
  assert.equal(
    count(
      rollback,
      /^ALTER TABLE public\."OrderShippingRateQuote" DISABLE ROW LEVEL SECURITY;$/gmu,
    ),
    1,
  );
  assert.doesNotMatch(rollback, /\bGRANT\b/iu);
  assert.match(migration, /class\.relname = 'OrderItem'[\s\S]*class\.relforcerowsecurity/u);
  assert.match(migration, /accepted_functions <> 4/u);
  assert.match(migration, /acl\.grantee = runtime_role_oid/u);
  assert.match(migration, /OrderShippingRateQuote ENABLE trigger catalog drifted/u);
  assert.match(
    migration,
    /^REVOKE ALL ON TABLE public\."OrderShippingRateQuote"\s+FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;$/gmu,
  );

  const sourceCatalog = orderChildSourceFunctionCatalog(rootDirectory)
    .filter((entry) => entry.touchesQuote);
  assert.equal(sourceCatalog.length, ORDER_QUOTE_DIRECT_FUNCTIONS.length);
  assert.deepEqual(
    sourceCatalog.map((entry) => entry.name).sort(),
    [...ORDER_QUOTE_DIRECT_FUNCTIONS],
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
      migration.includes(`(${expectedRow})`),
      `${entry.identity} is missing from the quote ENABLE preflight`,
    );
  }
  assert.equal(sourceCatalog.filter((entry) => entry.languageName === "plpgsql").length, 4);
  assert.equal(sourceCatalog.filter((entry) => entry.volatility === "v").length, 4);
  assert.equal(sourceCatalog.filter((entry) => entry.parallelSafety === "u").length, 4);
  assert.doesNotMatch(migration, /actual\.lanname = 'plpgsql'/u);

  return Object.freeze({
    draft,
    rollback,
    migration,
    ...ORDER_QUOTE_ENABLE_RELEASE,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (
    process.argv.length !== 2
    && (process.argv.length !== 3 || process.argv[2] !== "--verify")
  ) {
    throw new Error("usage: build-order-quote-rls-candidate.mjs [--verify]");
  }
  const release = buildOrderQuoteRlsCandidate();
  process.stdout.write(`${JSON.stringify({
    mode: "review-only",
    migrationTreeWritten: false,
    migrationName: release.migrationName,
    migrationSha256: release.migrationSha256,
    draftSha256: release.draftSha256,
    rollbackSha256: release.rollbackSha256,
    quoteDirectFunctionCount: ORDER_QUOTE_DIRECT_FUNCTIONS.length,
  })}\n`);
}

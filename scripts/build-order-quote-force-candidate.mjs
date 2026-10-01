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
const RELEASE_HEADER = "-- Reviewed policyless OrderShippingRateQuote FORCE hardening.\n-- Apply only through the guarded main-only production migration workflow.";
const DEFAULT_MIGRATION_PATH =
  "prisma/migrations/20261001060000_force_order_shipping_rate_quote_rls/migration.sql";
const migrationPath =
  process.env.ORDER_QUOTE_FORCE_MIGRATION_PATH?.trim() || DEFAULT_MIGRATION_PATH;

export const ORDER_QUOTE_FORCE_RELEASE = Object.freeze({
  migrationName: "20261001060000_force_order_shipping_rate_quote_rls",
  draftPath: "docs/rls-drafts/order-shipping-rate-quote-force.sql",
  rollbackPath: "docs/rls-drafts/order-shipping-rate-quote-force-rollback.sql",
  migrationPath,
  draftSha256: "702a5f59019551672fe4d93d0724a821107b74125b0b8127d80fbd7f9003dc4f",
  rollbackSha256: "6da97edd80d016cdf2006b58cdbccbf6605ebcc3cef5744102e6c7cca297da8d",
  migrationSha256: "390a307431fdc02c18af3daf8fc3d1ee7b34d2df84784379a523580c60f16d5a",
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

export function buildOrderQuoteForceCandidate(rootDirectory = process.cwd()) {
  const draft = readPinned(
    rootDirectory,
    ORDER_QUOTE_FORCE_RELEASE.draftPath,
    ORDER_QUOTE_FORCE_RELEASE.draftSha256,
  );
  const rollback = readPinned(
    rootDirectory,
    ORDER_QUOTE_FORCE_RELEASE.rollbackPath,
    ORDER_QUOTE_FORCE_RELEASE.rollbackSha256,
  );
  const migration = readPinned(
    rootDirectory,
    ORDER_QUOTE_FORCE_RELEASE.migrationPath,
    ORDER_QUOTE_FORCE_RELEASE.migrationSha256,
  );
  assert.ok(draft.startsWith(`${DRAFT_HEADER}\n`));
  assert.ok(rollback.startsWith(`${DRAFT_HEADER}\n`));
  assert.equal(draft.replace(DRAFT_HEADER, RELEASE_HEADER), migration);

  for (const source of [draft, rollback, migration]) {
    assert.equal(count(source, /^BEGIN;$/gmu), 1);
    assert.equal(count(source, /^COMMIT;$/gmu), 1);
    assert.doesNotMatch(source, /\b(?:CREATE|DROP)\s+POLICY\b/iu);
    assert.doesNotMatch(source, /^ALTER TABLE public\."(?:Order|OrderItem)"/gmu);
  }
  assert.equal(
    count(
      draft,
      /^ALTER TABLE public\."OrderShippingRateQuote" FORCE ROW LEVEL SECURITY;$/gmu,
    ),
    1,
  );
  assert.equal(
    count(
      rollback,
      /^ALTER TABLE public\."OrderShippingRateQuote" NO FORCE ROW LEVEL SECURITY;$/gmu,
    ),
    1,
  );
  assert.doesNotMatch(
    draft,
    /^ALTER TABLE public\."OrderShippingRateQuote" (?:ENABLE|NO FORCE) ROW LEVEL SECURITY;$/gmu,
  );
  assert.doesNotMatch(
    rollback,
    /^ALTER TABLE public\."OrderShippingRateQuote" DISABLE ROW LEVEL SECURITY;$/gmu,
  );
  assert.doesNotMatch(rollback, /\bGRANT\b/iu);
  assert.match(
    draft,
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
      draft.includes(`(${expectedRow})`),
      `${entry.identity} is missing from the quote FORCE preflight`,
    );
  }
  assert.equal(sourceCatalog.filter((entry) => entry.languageName === "plpgsql").length, 4);
  assert.equal(sourceCatalog.filter((entry) => entry.volatility === "v").length, 4);
  assert.equal(sourceCatalog.filter((entry) => entry.parallelSafety === "u").length, 4);
  assert.doesNotMatch(draft, /actual\.lanname = 'plpgsql'/u);

  return Object.freeze({
    draft,
    rollback,
    migration,
    ...ORDER_QUOTE_FORCE_RELEASE,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (
    process.argv.length !== 2
    && (process.argv.length !== 3 || process.argv[2] !== "--verify")
  ) {
    throw new Error("usage: build-order-quote-force-candidate.mjs [--verify]");
  }
  const release = buildOrderQuoteForceCandidate();
  process.stdout.write(`${JSON.stringify({
    mode: "review-only",
    migrationTreeWritten: false,
    migrationName: release.migrationName,
    migrationSha256: release.migrationSha256,
    rollbackSha256: release.rollbackSha256,
    quoteDirectFunctionCount: ORDER_QUOTE_DIRECT_FUNCTIONS.length,
  })}\n`);
}

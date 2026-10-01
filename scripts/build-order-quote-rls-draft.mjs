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

export const ORDER_QUOTE_ENABLE_DRAFT = Object.freeze({
  draftPath: "docs/rls-drafts/order-shipping-rate-quote-activation.sql",
  rollbackPath:
    "docs/rls-drafts/order-shipping-rate-quote-activation-rollback.sql",
  draftSha256:
    "4e2a274d9bc7d2c560da11c06af1dcf1f7298fe17535651c72337bf13151c3d0",
  rollbackSha256:
    "0cde0551f51e9350e81521246cdb6619bab4b1abf7e8b5543012f80f6ad4cc1e",
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const count = (value, pattern) => (value.match(pattern) ?? []).length;

function readPinned(rootDirectory, relativePath, expectedSha256) {
  const value = fs.readFileSync(path.join(rootDirectory, relativePath), "utf8");
  assert.equal(sha256(value), expectedSha256, `${relativePath} bytes drifted`);
  return value;
}

export function buildOrderQuoteRlsDraft(rootDirectory = process.cwd()) {
  const draft = readPinned(
    rootDirectory,
    ORDER_QUOTE_ENABLE_DRAFT.draftPath,
    ORDER_QUOTE_ENABLE_DRAFT.draftSha256,
  );
  const rollback = readPinned(
    rootDirectory,
    ORDER_QUOTE_ENABLE_DRAFT.rollbackPath,
    ORDER_QUOTE_ENABLE_DRAFT.rollbackSha256,
  );

  for (const source of [draft, rollback]) {
    assert.ok(source.startsWith(`${DRAFT_HEADER}\n`));
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
    draft,
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
  assert.match(draft, /class\.relname = 'OrderItem'[\s\S]*class\.relforcerowsecurity/u);
  assert.match(draft, /accepted_functions <> 4/u);
  assert.match(draft, /acl\.grantee = runtime_role_oid/u);
  assert.match(draft, /OrderShippingRateQuote ENABLE trigger catalog drifted/u);

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
      `${entry.identity} is missing from the quote ENABLE preflight`,
    );
  }
  assert.equal(sourceCatalog.filter((entry) => entry.languageName === "plpgsql").length, 4);
  assert.equal(sourceCatalog.filter((entry) => entry.volatility === "v").length, 4);
  assert.equal(sourceCatalog.filter((entry) => entry.parallelSafety === "u").length, 4);
  assert.doesNotMatch(draft, /actual\.lanname = 'plpgsql'/u);

  return Object.freeze({
    draft,
    rollback,
    ...ORDER_QUOTE_ENABLE_DRAFT,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (
    process.argv.length !== 2
    && (process.argv.length !== 3 || process.argv[2] !== "--verify")
  ) {
    throw new Error("usage: build-order-quote-rls-draft.mjs [--verify]");
  }
  const release = buildOrderQuoteRlsDraft();
  process.stdout.write(`${JSON.stringify({
    mode: "review-only",
    migrationTreeWritten: false,
    draftSha256: release.draftSha256,
    rollbackSha256: release.rollbackSha256,
    quoteDirectFunctionCount: ORDER_QUOTE_DIRECT_FUNCTIONS.length,
  })}\n`);
}

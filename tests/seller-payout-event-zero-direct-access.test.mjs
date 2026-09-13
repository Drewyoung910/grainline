import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AUTHORITY_MODULE,
  EXPECTED_AUTHORITY_CONSUMERS,
  EXPECTED_REFERENCE_FILES,
  inspectSellerPayoutEventSource,
  verifySellerPayoutEventZeroDirectAccess,
  verifySellerPayoutEventZeroDirectAccessAtCommit,
} from "../scripts/verify-seller-payout-event-zero-direct-access.mjs";

function records(extra = []) {
  const base = [
    {
      path: AUTHORITY_MODULE,
      source: [
        "grainline_seller_payout_event_apply",
        "grainline_seller_payout_latest_failure",
        "grainline_seller_payout_export_page",
      ].join("\n"),
    },
    ...EXPECTED_AUTHORITY_CONSUMERS.map((path) => ({
      path,
      source: 'import x from "@/lib/sellerPayoutEventAuthority";',
    })),
  ];
  for (const path of EXPECTED_REFERENCE_FILES) {
    if (!base.some((record) => record.path === path)) {
      base.push({ path, source: "export const sellerPayoutEvents = [];" });
    }
  }
  return [...base, ...extra];
}

test("current tracked application has zero direct SellerPayoutEvent access", () => {
  const result = verifySellerPayoutEventZeroDirectAccess();
  assert.equal(result.directAccessMatches, 0);
  assert.deepEqual(result.authorityConsumers, [...EXPECTED_AUTHORITY_CONSUMERS].sort());
  assert.deepEqual(result.referenceFiles, [...EXPECTED_REFERENCE_FILES].sort());
  assert.ok(result.scannedFiles > 0);
});

test("committed-tree proof independently scans an exact Git tree", () => {
  const result = verifySellerPayoutEventZeroDirectAccessAtCommit("HEAD");
  assert.equal(result.sourceCommit, "HEAD");
  assert.equal(result.directAccessMatches, 0);
  assert.deepEqual(result.authorityConsumers, [...EXPECTED_AUTHORITY_CONSUMERS].sort());
  assert.deepEqual(result.referenceFiles, [...EXPECTED_REFERENCE_FILES].sort());
  assert.ok(result.scannedFiles > 0);
  assert.throws(
    () => verifySellerPayoutEventZeroDirectAccessAtCommit("not-a-commit"),
    /source commit is invalid/,
  );
});

test("source inventory rejects every direct-access syntax family", () => {
  for (const direct of [
    "await prisma.sellerPayoutEvent.findMany()",
    "await client . sellerPayoutEvent.upsert({})",
    'await prisma["sellerPayoutEvent"].deleteMany()',
    "SELECT * FROM public.\"SellerPayoutEvent\"",
    "SELECT * FROM 'SellerPayoutEvent'",
  ]) {
    assert.throws(
      () => inspectSellerPayoutEventSource(records([{ path: "src/lib/unsafe.ts", source: direct }])),
      /direct application access remains/,
    );
  }
});

test("source inventory rejects missing, extra and malformed authority consumers", () => {
  assert.throws(
    () => inspectSellerPayoutEventSource(records().filter(
      (record) => record.path !== EXPECTED_AUTHORITY_CONSUMERS[0],
    )),
    /consumer inventory drifted/,
  );
  assert.throws(
    () => inspectSellerPayoutEventSource(records([{
      path: "src/lib/newConsumer.ts",
      source: 'import x from "@/lib/sellerPayoutEventAuthority";',
    }])),
    /consumer inventory drifted/,
  );
  assert.throws(() => inspectSellerPayoutEventSource([]), /inventory is empty/);
  assert.throws(
    () => inspectSellerPayoutEventSource([{ path: "outside.ts", source: "" }]),
    /shape drifted/,
  );
});

test("source inventory rejects any unreviewed SellerPayoutEvent reference file", () => {
  assert.throws(
    () => inspectSellerPayoutEventSource(records([{
      path: "src/lib/newProjection.ts",
      source: "export const sellerPayoutEventProjection = true;",
    }])),
    /reference inventory drifted/,
  );
});

test("authority module must retain all three reviewed fixed operations", () => {
  const candidate = records().map((record) => (
    record.path === AUTHORITY_MODULE
      ? {
          ...record,
          source: record.source.replace(
            "grainline_seller_payout_export_page",
            "sellerPayoutEvent authority marker",
          ),
        }
      : record
  ));
  assert.throws(() => inspectSellerPayoutEventSource(candidate), /module drifted/);
});

test("zero-direct-access proof is wired into the predecessor drain", () => {
  const source = readFileSync("scripts/seller-payout-event-predecessor-drain.mjs", "utf8");
  assert.match(source, /verifySellerPayoutEventZeroDirectAccess\(process\.cwd\(\)\)/);
  assert.match(source, /verifySellerPayoutEventZeroDirectAccessAtCommit/);
  assert.match(source, /zeroDirectAccess: true/);
});

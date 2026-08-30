import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORITY_MODULE,
  EXPECTED_AUTHORITY_CONSUMERS,
  EXPECTED_FIXED_OPERATIONS,
  EXPECTED_REFERENCE_FILES,
  inspectOrderPaymentEventSource,
  verifyOrderPaymentEventZeroDirectAccess,
  verifyOrderPaymentEventZeroDirectAccessAtCommit,
} from "../scripts/verify-order-payment-event-zero-direct-access.mjs";

function records(extra = []) {
  const base = [
    {
      path: AUTHORITY_MODULE,
      source: ["orderPaymentEvent authority marker", ...EXPECTED_FIXED_OPERATIONS].join("\n"),
    },
    ...EXPECTED_AUTHORITY_CONSUMERS.map((path) => ({
      path,
      source: 'import x from "@/lib/orderPaymentEventReadAuthority";',
    })),
  ];
  for (const path of EXPECTED_REFERENCE_FILES) {
    if (!base.some((record) => record.path === path)) {
      base.push({ path, source: "export const paymentEvents = [];" });
    }
  }
  return [...base, ...extra];
}

test("current tracked application has zero direct OrderPaymentEvent access", () => {
  const result = verifyOrderPaymentEventZeroDirectAccess();
  assert.equal(result.directAccessMatches, 0);
  assert.deepEqual(result.authorityConsumers, [...EXPECTED_AUTHORITY_CONSUMERS].sort());
  assert.deepEqual(result.referenceFiles, [...EXPECTED_REFERENCE_FILES].sort());
  assert.deepEqual(result.fixedOperations, EXPECTED_FIXED_OPERATIONS);
  assert.ok(result.scannedFiles > result.referenceFiles.length);
});

test("the exact checked-out Git tree has the closed authority inventory", () => {
  const operator = verifyOrderPaymentEventZeroDirectAccessAtCommit("HEAD");
  assert.equal(operator.directAccessMatches, 0);
  assert.deepEqual(operator.authorityConsumers, [...EXPECTED_AUTHORITY_CONSUMERS].sort());
  assert.deepEqual(operator.referenceFiles, [...EXPECTED_REFERENCE_FILES].sort());
  assert.ok(operator.scannedFiles > operator.referenceFiles.length);
  assert.throws(
    () => verifyOrderPaymentEventZeroDirectAccessAtCommit("not-a-commit"),
    /source commit is invalid/,
  );
});

test("source inventory rejects every direct-access syntax family", () => {
  for (const direct of [
    "await prisma.orderPaymentEvent.findMany()",
    "await client . orderPaymentEvent.create({})",
    'await prisma["orderPaymentEvent"].deleteMany()',
    'SELECT * FROM public."OrderPaymentEvent"',
    "SELECT * FROM OrderPaymentEvent",
    "select: { paymentEvents: true }",
    "paymentEvents: { where: { eventType: 'REFUND' } }",
    'select: { ["paymentEvents"]: true }',
    "const { orderPaymentEvent } = prisma",
  ]) {
    assert.throws(
      () => inspectOrderPaymentEventSource(records([{
        path: "src/lib/unsafe.ts",
        source: direct,
      }])),
      /direct application access remains/,
    );
  }
});

test("source inventory rejects missing, extra and malformed authority consumers", () => {
  assert.throws(
    () => inspectOrderPaymentEventSource(records().filter(
      (record) => record.path !== EXPECTED_AUTHORITY_CONSUMERS[0],
    )),
    /consumer inventory drifted/,
  );
  assert.throws(
    () => inspectOrderPaymentEventSource(records([{
      path: "src/lib/newConsumer.ts",
      source: 'import x from "@/lib/orderPaymentEventReadAuthority";',
    }])),
    /consumer inventory drifted/,
  );
  assert.throws(() => inspectOrderPaymentEventSource([]), /inventory is empty/);
  assert.throws(
    () => inspectOrderPaymentEventSource([{ path: "outside.ts", source: "" }]),
    /shape drifted/,
  );
});

test("source inventory rejects unreviewed references and missing fixed operations", () => {
  assert.throws(
    () => inspectOrderPaymentEventSource(records([{
      path: "src/lib/newProjection.ts",
      source: "export const orderPaymentEventProjection = true;",
    }])),
    /reference inventory drifted/,
  );
  const missingOperation = records().map((record) => (
    record.path === AUTHORITY_MODULE
      ? { ...record, source: record.source.replace(EXPECTED_FIXED_OPERATIONS[0], "removed") }
      : record
  ));
  assert.throws(
    () => inspectOrderPaymentEventSource(missingOperation),
    /module drifted/,
  );
});

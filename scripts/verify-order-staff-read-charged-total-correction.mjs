#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION =
  "20260905010000_correct_order_staff_read_charged_total";
export const ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION_SHA256 =
  "a17597b111b368bba7ff17c16fb196c0c0c336d340987920e91c919d952eaea8";
export const ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION_FUNCTION_NAMES =
  Object.freeze([
    "grainline_order_staff_page_v2",
    "grainline_order_staff_detail_v2",
  ]);

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderStaffReadChargedTotalCorrection(root = process.cwd()) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const sha256 = createHash("sha256").update(migration).digest("hex");
  assert.equal(
    sha256,
    ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION_SHA256,
    "Order staff charged-total correction bytes drifted",
  );
  assert.equal(count(migration, /^CREATE FUNCTION public\.grainline_order_staff_/gmu), 2);
  assert.equal(count(migration, /^SECURITY DEFINER$/gmu), 2);
  assert.equal(count(migration, /^SET search_path = pg_catalog$/gmu), 2);
  assert.equal(count(migration, /^REVOKE ALL ON FUNCTION/gmu), 2);
  assert.equal(count(migration, /^GRANT /gmu), 0);
  assert.equal(count(migration, /source_order\."chargedTotalCents"/gu), 2);
  assert.match(migration, /public\.grainline_order_staff_page\(/u);
  assert.match(migration, /public\.grainline_order_staff_detail\(/u);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|public\.)/iu);

  return Object.freeze({
    migration: ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION,
    sha256,
    correctedFunctionCount: 2,
    grantsChanged: false,
    rlsChanged: false,
    rowDataChanged: false,
  });
}

export function appendReviewedOrderStaffReadChargedTotalCorrection({
  root = process.cwd(),
  laterMigrations,
  reviewedSuccessors,
  expectedPredecessor,
}) {
  if (!laterMigrations.includes(ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION)) {
    return false;
  }
  assert.equal(
    reviewedSuccessors.at(-1),
    expectedPredecessor,
    "Order staff charged-total correction requires its exact reviewed predecessor",
  );
  verifyOrderStaffReadChargedTotalCorrection(root);
  reviewedSuccessors.push(ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyOrderStaffReadChargedTotalCorrection(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Order staff charged-total correction verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

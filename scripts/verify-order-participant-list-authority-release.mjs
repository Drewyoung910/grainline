#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  computeMigrationTreeSha256,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  ORDER_PARTICIPANT_LIST_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION_TREE_SHA256,
  verifyOrderParticipantListAuthorityMigrationBytes,
} from "./order-participant-list-authority-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
} from "./stage-order-payment-event-force-migration.mjs";
import {
  verifyOrderPaymentEventForceRelease,
} from "./verify-order-payment-event-force-release.mjs";

export const ORDER_PARTICIPANT_LIST_AUTHORITY_PHASE =
  "order-participant-list-authority-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderParticipantListAuthorityRelease(
  root = process.cwd(),
) {
  const predecessor = verifyOrderPaymentEventForceRelease(root, {
    allowReviewedOrderParticipantListSuccessor: true,
  });
  assert.equal(
    predecessor.migration,
    ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
    "Order participant list authority predecessor is not OrderPaymentEvent FORCE",
  );

  const { migration, migrationSha256 } =
    verifyOrderParticipantListAuthorityMigrationBytes(root);
  const migrationDirectory = path.join(root, "prisma/migrations");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION);
  const migrationTreeSha256 = computeMigrationTreeSha256(
    migrationDirectory,
    migrationNames,
  );
  assert.equal(
    migrationTreeSha256,
    ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION_TREE_SHA256,
    "Order participant list-authority migration tree drifted",
  );
  assert.equal(count(migration, /^CREATE FUNCTION public\.grainline_order_/gmu), 4);
  assert.equal(count(migration, /^SECURITY DEFINER$/gmu), 4);
  assert.equal(count(migration, /^STABLE$/gmu), 4);
  assert.equal(count(migration, /^PARALLEL SAFE$/gmu), 4);
  assert.equal(count(migration, /^SET search_path = pg_catalog$/gmu), 4);
  for (const identity of ORDER_PARTICIPANT_LIST_AUTHORITY_FUNCTIONS) {
    const name = identity.slice(0, identity.indexOf("("));
    assert.match(migration, new RegExp(`FUNCTION public\\.${name}\\(`, "u"));
  }
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(migration, /(?:GRANT|REVOKE)[\s\S]*ON TABLE/iu);
  assert.doesNotMatch(migration, /EXECUTE\s+[^;]*(?:format|quote_ident)/iu);

  return Object.freeze({
    phase: ORDER_PARTICIPANT_LIST_AUTHORITY_PHASE,
    migration: ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION,
    migrationSha256,
    migrationTreeSha256,
    predecessorMigration: ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
    runtimeFunctionCount: 4,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    rowDataChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifyOrderParticipantListAuthorityRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `Order participant list-authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

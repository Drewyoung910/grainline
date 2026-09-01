import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION =
  "20260831233000_prepare_order_participant_list_authority";
export const ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION_SHA256 =
  "20912226c1c096509f8aaca10f4dd117fd08e2e9455c05b65570ec8d55cb37ce";
export const ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION_TREE_SHA256 =
  "79f9757418fdb4bcee828213d356ed027eb0b6ad777dea5d420d33e75f4ac82e";
export const ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION =
  "20260901010000_prepare_order_participant_detail_authority";
export const ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION_SHA256 =
  "7f971c993418c4900b9e37972b24a8e5e6ef8e4a846b73b8b739e4364d96d054";
export const ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION_TREE_SHA256 =
  "800d7e486e2108e021988b79d534ac7ef40914edabe590844f048216881ffea4";

export const ORDER_PARTICIPANT_LIST_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_buyer_count(text)",
  "grainline_order_buyer_page(text,integer,bigint,text)",
  "grainline_order_seller_count(text)",
  "grainline_order_seller_page(text,integer,bigint,text)",
]);
export const ORDER_PARTICIPANT_DETAIL_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_buyer_detail(text,text)",
  "grainline_order_seller_detail(text,text)",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyOrderParticipantListAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION_SHA256,
    "Order participant list-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function verifyOrderParticipantDetailAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION_SHA256,
    "Order participant detail-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function appendReviewedOrderParticipantListAuthoritySuccessor({
  root = process.cwd(),
  laterMigrations,
  reviewedSuccessors,
  expectedPredecessor,
}) {
  if (!laterMigrations.includes(ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION)) {
    return false;
  }
  assert.equal(
    reviewedSuccessors.at(-1),
    expectedPredecessor,
    "Order participant list authority requires its exact reviewed predecessor",
  );
  verifyOrderParticipantListAuthorityMigrationBytes(root);
  reviewedSuccessors.push(ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION);
  if (laterMigrations.includes(ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION)) {
    verifyOrderParticipantDetailAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION);
  }
  return true;
}

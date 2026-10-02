import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const MIGRATION =
  "prisma/migrations/20261002030000_preserve_order_shipping_dispute_evidence/migration.sql";
const sql = readFileSync(MIGRATION, "utf8");
const normalized = sql.replace(/\s+/gu, " ");

function functionBody(name) {
  const marker = `$${name}$`;
  const start = sql.indexOf(`AS ${marker}`);
  const end = sql.indexOf(`${marker};`, start);
  assert.ok(start >= 0 && end > start, `${name} body is missing`);
  return sql.slice(start + `AS ${marker}`.length, end);
}

const body = functionBody("grainline_order_buyer_pii_prune_batch");
const accountDeletionBody = functionBody("grainline_order_account_deletion_blockers");
const markReviewedBody = functionBody("grainline_order_staff_mark_reviewed");

test("shipping evidence retention migration is drift-fenced and posture preserving", () => {
  assert.match(
    sql,
    /148d3a7041af2b92f159ece8c8be3999bc4906b47f578231990322d8dc456e0b/u,
  );
  assert.match(
    sql,
    new RegExp(createHash("sha256").update(body).digest("hex"), "u"),
  );
  assert.match(sql, /115fbe5b54f5bc31426ee7925018c6c9d3f9ced9ab300069f37d49d848c63255/u);
  assert.match(sql, /86b2fcac89439b5b17789e58bebab33ea5c718bf51fb8be5964d94a2317c2c2f/u);
  assert.match(
    sql,
    new RegExp(createHash("sha256").update(accountDeletionBody).digest("hex"), "u"),
  );
  assert.match(
    sql,
    new RegExp(createHash("sha256").update(markReviewedBody).digest("hex"), "u"),
  );
  assert.match(
    normalized,
    /REVOKE ALL ON FUNCTION public\.grainline_order_buyer_pii_prune_batch\(integer\) FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.match(
    normalized,
    /GRANT EXECUTE ON FUNCTION public\.grainline_order_buyer_pii_prune_batch\(integer\) TO grainline_app_runtime/u,
  );
  assert.doesNotMatch(normalized, /ALTER TABLE|CREATE POLICY|DROP FUNCTION/u);
});

test("account deletion cannot bypass retained shipping evidence", () => {
  const compact = accountDeletionBody.replace(/\s+/gu, " ");
  assert.match(compact, /shipping_evidence_cutoff[\s\S]*INTERVAL '180 days'/u);
  for (const field of [
    "trackingCarrier",
    "trackingNumber",
    "shippoTransactionId",
    "labelUrl",
  ]) {
    assert.match(compact, new RegExp(`"${field}" IS NOT NULL`, "u"));
  }
  assert.match(compact, /"paymentOpenDisputeBlocked"/u);
  assert.match(compact, /"reviewNeeded"/u);
  assert.match(compact, /"labelClawbackStatus" = 'MANUAL_REVIEW'/u);
  assert.match(compact, /FROM public\."OrderDisputeRecovery" AS recovery/u);
  assert.match(compact, /FROM public\."Case" AS source_case/u);
  assert.doesNotMatch(accountDeletionBody, /\bEXECUTE\b/iu);
});

test("staff review cannot clear a manual label reconciliation hold", () => {
  const compact = markReviewedBody.replace(/\s+/gu, " ");
  assert.match(
    compact,
    /"labelClawbackStatus" IN \( 'RETRY_PENDING', 'RETRYING', 'MANUAL_REVIEW' \)/u,
  );
  assert.doesNotMatch(markReviewedBody, /\bEXECUTE\b/iu);
});

test("buyer PII and non-address shipment evidence have separate fixed windows", () => {
  const compact = body.replace(/\s+/gu, " ");
  assert.match(compact, /fixed_cutoff[\s\S]*INTERVAL '90 days'/u);
  assert.match(compact, /shipping_evidence_cutoff[\s\S]*INTERVAL '180 days'/u);
  assert.match(
    compact,
    /GREATEST\( COALESCE\(order_row\."deliveredAt", order_row\."pickedUpAt"\), order_row\."paidAt", order_row\."estimatedDeliveryDate" \) < shipping_evidence_cutoff/u,
  );
  assert.match(compact, /"labelClawbackStatus" IS DISTINCT FROM 'MANUAL_REVIEW'/u);
  assert.match(compact, /FROM public\."OrderDisputeRecovery" AS recovery/u);
  for (const status of [
    "REVERSAL_PENDING",
    "REVERSING",
    "RESTORE_PENDING",
    "RESTORING",
    "MANUAL_REVIEW",
  ]) {
    assert.match(
      compact,
      new RegExp(`'${status}'::public\\."OrderDisputeRecoveryStatus"`, "u"),
    );
  }
  assert.match(compact, /due\.pii_due OR due\.shipping_evidence_due/u);
  assert.match(compact, /FOR UPDATE OF order_row SKIP LOCKED LIMIT p_batch_size/u);
});

test("the 90-day phase minimizes buyer data without deleting retained shipping evidence", () => {
  const compact = body.replace(/\s+/gu, " ");
  for (const field of [
    "buyerEmail",
    "buyerName",
    "shipToLine1",
    "shipToPostalCode",
    "quotedToLine1",
    "quotedToPhone",
    "sellerNotes",
    "giftNote",
  ]) {
    assert.match(
      compact,
      new RegExp(`"${field}" = CASE WHEN prune_candidates\\.pii_due THEN NULL`, "u"),
    );
  }
  assert.match(
    compact,
    /DELETE FROM public\."OrderShippingRateQuote" AS quote USING prune_candidates WHERE prune_candidates\.pii_due/u,
  );
  assert.match(
    compact,
    /"buyerDataPurgedAt" = CASE WHEN prune_candidates\.pii_due THEN COALESCE/u,
  );
});

test("the 180-day phase clears only non-address shipment evidence", () => {
  const compact = body.replace(/\s+/gu, " ");
  for (const field of [
    "trackingCarrier",
    "trackingNumber",
    "shippoShipmentId",
    "shippoRateObjectId",
    "shippoTransactionId",
    "labelUrl",
    "labelCarrier",
    "labelTrackingNumber",
  ]) {
    assert.match(
      compact,
      new RegExp(`"${field}" = CASE WHEN prune_candidates\\.shipping_evidence_due THEN NULL`, "u"),
    );
  }
  assert.match(compact, /"reviewNeeded" = false/u);
  assert.match(compact, /"paymentOpenDisputeBlocked" = false/u);
  for (const status of ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"]) {
    assert.match(compact, new RegExp(`'${status}'::public\\."CaseStatus"`, "u"));
  }
  assert.doesNotMatch(body, /\bEXECUTE\b/iu);
  assert.doesNotMatch(body, /\bformat\s*\(/iu);
});

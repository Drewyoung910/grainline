import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const DRAFT_PATH =
  "docs/rls-drafts/case-case-message-invariants.sql";
const sql = fs.readFileSync(DRAFT_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");

test("Case invariant SQL is promoted only through the pinned staging script", () => {
  assert.match(sql, /DRAFT ONLY\. Do not apply to any persistent database/);
  assert.equal(
    fs.existsSync(
      "prisma/migrations/20260730010000_enforce_case_message_invariants/migration.sql",
    ),
    true,
  );
  assert.doesNotMatch(sql, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /\bGRANT\b/);
});

test("target rows are frozen and every trigger-only legacy shape is rechecked", () => {
  assert.match(normalizedSql, /SET LOCAL lock_timeout = '10s'/);
  assert.match(normalizedSql, /SET LOCAL statement_timeout = '60s'/);
  assert.match(
    normalizedSql,
    /pg_catalog\.pg_advisory_xact_lock\( pg_catalog\.hashtextextended\('grainline\.case\.rls\.activation', 0\) \)/,
  );
  assert.match(
    normalizedSql,
    /LOCK TABLE public\."Case", public\."CaseMessage", public\."CaseMessageAttachment" IN SHARE ROW EXCLUSIVE MODE/,
  );
  assert.match(
    normalizedSql,
    /Case relationship preflight found incompatible rows/,
  );
  assert.match(
    normalizedSql,
    /Case opening-source preflight found incompatible rows/,
  );
  assert.match(
    normalizedSql,
    /CaseMessage relationship preflight found incompatible rows/,
  );
  assert.match(
    normalizedSql,
    /CaseMessageAttachment relationship preflight found incompatible rows/,
  );
  assert.match(
    normalizedSql,
    /summary\.seller_count IS DISTINCT FROM 1/,
  );
  assert.match(
    normalizedSql,
    /message\."createdAt" > case_row\."updatedAt"/,
  );
});

test("Stripe-dispute openings bind to an exact same-Order payment event", () => {
  assert.match(normalizedSql, /compatible preparation migration already adds/);
  assert.match(
    normalizedSql,
    /dispute_event\."eventType" <> 'DISPUTE'/,
  );
  assert.match(
    normalizedSql,
    /dispute_event\.metadata->>'stripeEventType' IS DISTINCT FROM 'charge\.dispute\.created'/,
  );
  assert.match(
    normalizedSql,
    /dispute_event\.metadata->>'disputeId' IS DISTINCT FROM dispute_event\."stripeObjectId"/,
  );
  assert.match(
    normalizedSql,
    /dispute_event\.metadata->>'chargeId' IS DISTINCT FROM order_stripe_charge_id/,
  );
  assert.match(
    normalizedSql,
    /dispute_event\.metadata->>'stripeEventCreated' !~ '\^\[0-9\]\{1,12\}\$'/,
  );
  assert.match(
    normalizedSql,
    /pg_catalog\.lower\(COALESCE\(dispute_event\.status, ''\)\) IN \( 'won', 'lost', 'prevented', 'warning_closed' \)/,
  );
  assert.match(
    normalizedSql,
    /dispute_event\.currency !~ '\^\[a-z\]\{3\}\$'/,
  );
  assert.match(
    normalizedSql,
    /NEW\.reason <> 'OTHER'::public\."CaseReason"/,
  );
  assert.match(
    normalizedSql,
    /Case webhook opening source is invalid/,
  );
});

test("Case lifecycle constraints reject mixed active and terminal evidence", () => {
  for (const constraint of [
    "Case_distinct_participants_check",
    "Case_clock_order_check",
    "Case_lifecycle_evidence_check",
    "Case_resolution_shape_check",
    "Case_resolution_marks_check",
  ]) {
    assert.match(sql, new RegExp(`"${constraint}"`), constraint);
    assert.match(
      normalizedSql,
      new RegExp(`VALIDATE CONSTRAINT "${constraint}"`),
      constraint,
    );
  }
  assert.match(
    normalizedSql,
    /status NOT IN \( 'RESOLVED'.*'CLOSED'.*AND resolution IS NULL.*AND "refundAmountCents" IS NULL.*AND "stripeRefundId" IS NULL.*AND "resolvedAt" IS NULL.*AND "resolvedById" IS NULL/s,
  );
  assert.match(
    normalizedSql,
    /resolution = 'DISMISSED'.*AND "refundAmountCents" IS NULL.*AND "stripeRefundId" IS NULL/s,
  );
  assert.match(
    normalizedSql,
    /resolution IN \( 'REFUND_FULL'.*'REFUND_PARTIAL'.*AND "refundAmountCents" > 0.*AND "stripeRefundId" IS NOT NULL.*AND pg_catalog\.btrim\("stripeRefundId"\) <> ''/s,
  );
});

test("Case parties and immutable authority fields are database checked", () => {
  assert.match(
    normalizedSql,
    /CREATE FUNCTION public\.grainline_case_relationship_valid\(\)/,
  );
  assert.match(
    normalizedSql,
    /pg_catalog\.count\(DISTINCT locked_seller\.seller_user_id\)/,
  );
  assert.match(
    normalizedSql,
    /seller_count <> 1/,
  );
  assert.match(
    normalizedSql,
    /NEW\."buyerId" IS DISTINCT FROM order_buyer_id/,
  );
  assert.match(
    normalizedSql,
    /FROM public\."Order" AS orders WHERE orders\.id = NEW\."orderId" FOR SHARE/,
  );
  assert.match(
    normalizedSql,
    /ORDER BY item\.id, listing\.id, seller\.id FOR SHARE OF item, listing, seller/,
  );
  assert.match(
    normalizedSql,
    /CREATE FUNCTION public\.grainline_case_authority_fields_immutable\(\)/,
  );
  for (const field of [
    '"orderId"',
    '"sellerId"',
    "reason",
    '"openedByPaymentEventId"',
    '"createdAt"',
  ]) {
    assert.match(normalizedSql, new RegExp(`NEW\\.${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} IS DISTINCT FROM OLD\\.${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), field);
  }
});

test("Case status graph reserves review reopen for the later fixed operation", () => {
  assert.match(
    normalizedSql,
    /CREATE FUNCTION public\.grainline_case_status_transition_valid\(\)/,
  );
  assert.match(normalizedSql, /Invalid Case status transition/);
  assert.match(
    normalizedSql,
    /OLD\.status = 'PENDING_CLOSE'.*NEW\.status IN \( 'IN_DISCUSSION'.*'RESOLVED'/s,
  );
  assert.match(
    normalizedSql,
    /OLD\.status = 'RESOLVED'.*NEW\.status = 'CLOSED'/s,
  );
  assert.match(
    normalizedSql,
    /OR NEW\.status = 'UNDER_REVIEW'/,
  );
  assert.doesNotMatch(
    normalizedSql,
    /NEW\.status = 'OPEN'/,
  );
});

test("CaseMessage author kind is durable and source-derived", () => {
  assert.match(
    normalizedSql,
    /ALTER COLUMN "authorKind" SET NOT NULL/,
  );
  assert.match(
    normalizedSql,
    /CREATE FUNCTION public\.grainline_case_message_author_valid\(\)/,
  );
  assert.match(
    normalizedSql,
    /NEW\."authorKind" = 'BUYER'.*NEW\."authorId" IS DISTINCT FROM parent\."buyerId"/s,
  );
  assert.match(
    normalizedSql,
    /NEW\."authorKind" = 'SELLER'.*NEW\."authorId" IS DISTINCT FROM parent\."sellerId"/s,
  );
  assert.match(
    normalizedSql,
    /NEW\."authorKind" = 'STAFF'.*author\.role NOT IN \( 'EMPLOYEE'.*'ADMIN'/s,
  );
  assert.match(
    normalizedSql,
    /CaseMessage authority fields are immutable/,
  );
  assert.match(
    normalizedSql,
    /FROM public\."User" AS actor WHERE actor\.id = NEW\."authorId" FOR SHARE.*FROM public\."Case" AS case_row WHERE case_row\.id = NEW\."caseId" FOR UPDATE/s,
  );
  assert.doesNotMatch(
    normalizedSql,
    /FROM public\."User" AS actor WHERE actor\.id = NEW\."authorId" FOR KEY SHARE/,
  );
});

test("ordinary Case openings retain a message while webhook openings remain honest", () => {
  assert.match(
    normalizedSql,
    /case_row\."openedByPaymentEventId" IS NULL AND NOT EXISTS \( SELECT 1 FROM public\."CaseMessage"/,
  );
  assert.match(
    normalizedSql,
    /CREATE CONSTRAINT TRIGGER grainline_case_opening_evidence_valid/,
  );
  assert.match(
    normalizedSql,
    /CREATE CONSTRAINT TRIGGER grainline_case_message_delete_keeps_opening_evidence/,
  );
  assert.match(
    normalizedSql,
    /TG_RELID = 'public\."Case"'::pg_catalog\.regclass/,
  );
  assert.match(
    normalizedSql,
    /FROM public\."Case" AS case_row WHERE case_row\.id = target_case_id FOR UPDATE/,
  );
  assert.doesNotMatch(normalizedSql, /TG_TABLE_NAME = 'Case'/);
  assert.equal(
    (normalizedSql.match(/DEFERRABLE INITIALLY DEFERRED/g) ?? []).length,
    2,
  );
});

test("CaseMessageAttachment is bound to the author and parent clock", () => {
  assert.match(
    normalizedSql,
    /CREATE FUNCTION public\.grainline_case_attachment_parent_valid\(\)/,
  );
  assert.match(
    normalizedSql,
    /NEW\."uploaderId" IS DISTINCT FROM parent\."authorId"/,
  );
  assert.match(
    normalizedSql,
    /NEW\."createdAt" < parent\."createdAt"/,
  );
  assert.match(
    normalizedSql,
    /FROM public\."CaseMessage" AS message WHERE message\.id = NEW\."caseMessageId" FOR UPDATE/,
  );
});

test("invariant trigger helpers are pinned and runtime-inaccessible", () => {
  const functionNames = [
    "grainline_case_relationship_valid",
    "grainline_case_authority_fields_immutable",
    "grainline_case_status_transition_valid",
    "grainline_case_message_author_valid",
    "grainline_case_message_authority_fields_immutable",
    "grainline_case_message_maintain_thread",
    "grainline_case_opening_evidence_valid",
    "grainline_case_attachment_parent_valid",
  ];
  for (const name of functionNames) {
    assert.match(
      normalizedSql,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(\\) FROM PUBLIC, grainline_app_runtime`),
      name,
    );
  }
  assert.equal(
    (normalizedSql.match(/SET search_path = pg_catalog/g) ?? []).length,
    functionNames.length,
  );
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION/);
  assert.doesNotMatch(sql, /pg_catalog\.greatest/i);
  assert.match(sql, /\bGREATEST\(/);
  assert.doesNotMatch(sql, /\bEXECUTE\s+(?!FUNCTION\b)/i);
  assert.doesNotMatch(sql, /\bformat\s*\(/i);
});

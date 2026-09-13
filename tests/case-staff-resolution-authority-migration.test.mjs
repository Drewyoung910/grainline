import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");

const functions = [
  {
    name: "grainline_case_staff_resolution_prepare",
    signature:
      'text, text, public."CaseResolution", integer, jsonb',
  },
  {
    name: "grainline_case_staff_resolution_provider_record",
    signature:
      "text, text, text, text, text[], text[], text, integer, boolean, boolean",
  },
  {
    name: "grainline_case_staff_resolution_finalize",
    signature: "text, text",
  },
  {
    name: "grainline_case_staff_resolution_reconcile",
    signature: "text, text, text, text",
  },
];

test("staff resolution authority is compatible and does not activate Case RLS", () => {
  assert.match(sql, /Compatible fixed authority/);
  assert.doesNotMatch(
    normalizedSql,
    /ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(normalizedSql, /CREATE POLICY/);
  assert.doesNotMatch(normalizedSql, /REVOKE .* ON TABLE public\."Case"/);
  assert.doesNotMatch(normalizedSql, /DROP (?:TABLE|COLUMN|FUNCTION)/);
});

test("the four operations are pinned SECURITY DEFINER and runtime-executable only", () => {
  for (const { name, signature } of functions) {
    const delimiter = `$${name}$`;
    const bodyStart = sql.indexOf(`AS ${delimiter}`);
    const bodyEnd = sql.indexOf(`${delimiter};`, bodyStart + delimiter.length);
    const body =
      bodyStart >= 0 && bodyEnd > bodyStart
        ? sql.slice(bodyStart + `AS ${delimiter}`.length, bodyEnd)
        : "";
    assert.ok(body, `${name} body`);
    assert.match(
      normalizedSql,
      new RegExp(
        `${name}\\([^)]*\\) RETURNS jsonb LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog`,
      ),
      name,
    );
    const escapedSignature = signature
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("\\ ", "\\s*");
    assert.match(
      normalizedSql,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(\\s*${escapedSignature}\\s*\\) FROM PUBLIC, grainline_app_runtime`,
      ),
      name,
    );
    assert.match(
      normalizedSql,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\(\\s*${escapedSignature}\\s*\\) TO grainline_app_runtime`,
      ),
      name,
    );
    assert.doesNotMatch(body, /\bEXECUTE\b/i, name);
    assert.doesNotMatch(body, /\bformat\s*\(/i, name);
  }
});

test("prepare derives the claim, refund amount, stock plan and provider scope", () => {
  assert.match(
    normalizedSql,
    /FROM public\."User" AS actor WHERE actor\.id = p_actor_user_id FOR SHARE/,
  );
  const orderLock = normalizedSql.indexOf(
    'FROM public."Order" AS orders WHERE orders.id = source_order_id FOR UPDATE',
  );
  const caseLock = normalizedSql.indexOf(
    'FROM public."Case" AS case_row WHERE case_row.id = p_case_id AND case_row."orderId" = locked_order.id FOR UPDATE',
  );
  const itemLocks = normalizedSql.indexOf(
    "ORDER BY item.id, listing.id, seller.id FOR SHARE OF item, listing, seller",
  );
  assert.ok(orderLock >= 0);
  assert.ok(caseLock > orderLock);
  assert.ok(itemLocks > caseLock);
  assert.match(
    normalizedSql,
    /p_resolution = 'REFUND_FULL'.*refund_amount_cents := order_total_cents::integer/s,
  );
  assert.match(
    normalizedSql,
    /requested\.quantity > available\.quantity/,
  );
  assert.match(
    normalizedSql,
    /'case-resolve:' \|\| claim_id \|\| ':' \|\| p_resolution::text \|\| ':' \|\| refund_amount_cents::text/,
  );
  assert.match(
    normalizedSql,
    /INSERT INTO public\."CaseResolutionClaim"/,
  );
  assert.match(
    normalizedSql,
    /"caseResolutionClaimId" = claim_id[\s\S]*"sellerRefundId" = CASE/,
  );
  assert.match(
    normalizedSql,
    /existing_claim\."stockRestorePlan" IS DISTINCT FROM stock_restore_plan/,
  );
});

test("provider record has mutually exclusive recorded and ambiguous branches", () => {
  assert.match(
    normalizedSql,
    /p_provider_outcome IS NULL OR p_provider_outcome NOT IN \('RECORDED', 'AMBIGUOUS'\)/,
  );
  assert.match(
    normalizedSql,
    /p_provider_outcome NOT IN \('RECORDED', 'AMBIGUOUS'\)/,
  );
  assert.match(
    normalizedSql,
    /p_provider_outcome = 'AMBIGUOUS'[\s\S]*p_primary_refund_id IS NOT NULL[\s\S]*Ambiguous provider outcome cannot assert evidence/,
  );
  assert.match(
    normalizedSql,
    /'RECONCILIATION_REQUIRED'::public\."CaseResolutionClaimStatus"/,
  );
  const ambiguousStart = normalizedSql.indexOf(
    "IF p_provider_outcome = 'AMBIGUOUS' THEN",
  );
  const ambiguousEnd = normalizedSql.indexOf(
    "IF p_primary_refund_id IS NULL",
    ambiguousStart,
  );
  const ambiguousBody = normalizedSql.slice(ambiguousStart, ambiguousEnd);
  assert.doesNotMatch(
    ambiguousBody,
    /INSERT INTO public\."OrderPaymentEvent"/,
  );
  assert.match(
    normalizedSql,
    /p_primary_refund_id !~ '\^re_\[A-Za-z0-9\]\+\$'/,
  );
  assert.match(
    normalizedSql,
    /p_primary_refund_id = ANY\(p_refund_ids\)/,
  );
  assert.match(
    normalizedSql,
    /INSERT INTO public\."OrderPaymentEvent"[\s\S]*'local:case_refund_recorded:' \|\| p_primary_refund_id/,
  );
  assert.match(
    normalizedSql,
    /"orderPaymentEventId" = payment_event_id[\s\S]*'PROVIDER_RECORDED'/,
  );
});

test("finalize trusts only the claim and its exact linked payment evidence", () => {
  assert.match(
    normalizedSql,
    /grainline_case_staff_resolution_finalize\( p_actor_user_id text, p_resolution_claim_id text \)/,
  );
  assert.match(
    normalizedSql,
    /locked_claim\."staffActorId" IS DISTINCT FROM locked_actor\.id/,
  );
  assert.match(
    normalizedSql,
    /locked_claim\.status <> 'PROVIDER_RECORDED'::public\."CaseResolutionClaimStatus"/,
  );
  assert.match(
    normalizedSql,
    /linked_event\.metadata->>'resolutionClaimId' IS DISTINCT FROM locked_claim\.id/,
  );
  assert.match(
    normalizedSql,
    /Case finalization stock plan no longer validates/,
  );
  assert.match(
    normalizedSql,
    /message_id := 'case_resolution_message_' \|\| locked_claim\.id/,
  );
  assert.match(
    normalizedSql,
    /INSERT INTO public\."AdminAuditLog"/,
  );
  assert.match(
    normalizedSql,
    /status = 'FINALIZED'::public\."CaseResolutionClaimStatus"/,
  );
  assert.match(
    normalizedSql,
    /SET "caseResolutionClaimId" = NULL/,
  );
});

test("reconciliation is admin-only, reuses scope, and cannot release evidence", () => {
  assert.match(
    normalizedSql,
    /locked_actor\.role <> 'ADMIN'::public\."Role"/,
  );
  assert.match(
    normalizedSql,
    /p_reconciliation_action IS NULL OR p_reconciliation_action NOT IN \( 'RETRY_EXISTING_SCOPE', 'CONFIRMED_NO_PROVIDER_EFFECT' \)/,
  );
  assert.match(
    normalizedSql,
    /p_reconciliation_action NOT IN \( 'RETRY_EXISTING_SCOPE', 'CONFIRMED_NO_PROVIDER_EFFECT' \)/,
  );
  assert.match(
    normalizedSql,
    /locked_claim\."orderPaymentEventId" IS NOT NULL/,
  );
  assert.match(
    normalizedSql,
    /'RETRY_EXISTING_SCOPE'[\s\S]*"sellerRefundId" = 'pending'[\s\S]*'PROVIDER_PENDING'/,
  );
  assert.match(
    normalizedSql,
    /'RELEASED_NO_PROVIDER_EFFECT'::public\."CaseResolutionClaimStatus"/,
  );
  assert.match(
    normalizedSql,
    /"reconciliationAction" = 'CONFIRMED_NO_PROVIDER_EFFECT'/,
  );
  assert.match(
    normalizedSql,
    /'idempotencyScope', locked_claim\."idempotencyScope"/,
  );
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729051000_prepare_case_open_authority/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");
const body = sql.slice(
  sql.indexOf("AS $grainline_case_open$"),
  sql.indexOf("$grainline_case_open$;"),
);

test("Case-open authority is compatible and does not activate Case RLS", () => {
  assert.match(sql, /Compatible fixed authority/);
  assert.doesNotMatch(
    normalizedSql,
    /ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(normalizedSql, /CREATE POLICY/);
  assert.doesNotMatch(normalizedSql, /REVOKE .* ON TABLE public\."Case"/);
  assert.doesNotMatch(normalizedSql, /DROP (?:TABLE|COLUMN|FUNCTION)/);
});

test("private Case-open replay ledger is forced, policyless, and runtime-inaccessible", () => {
  assert.match(
    normalizedSql,
    /CREATE TABLE public\."CaseOpenApplication"/,
  );
  assert.match(
    normalizedSql,
    /FOREIGN KEY \("caseId", "orderId"\) REFERENCES public\."Case"\(id, "orderId"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
  );
  assert.match(
    normalizedSql,
    /ALTER TABLE public\."CaseOpenApplication" ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    normalizedSql,
    /ALTER TABLE public\."CaseOpenApplication" FORCE ROW LEVEL SECURITY/,
  );
  assert.match(
    normalizedSql,
    /REVOKE ALL ON TABLE public\."CaseOpenApplication" FROM PUBLIC, grainline_app_runtime/,
  );
  assert.doesNotMatch(normalizedSql, /CREATE POLICY/);
  assert.doesNotMatch(
    normalizedSql,
    /GRANT .* ON TABLE public\."CaseOpenApplication"/,
  );
});

test("Case-open function is pinned, fixed, and runtime-executable only", () => {
  assert.match(
    normalizedSql,
    /grainline_case_open\( p_actor_user_id text, p_order_id text, p_reason text, p_description text \) RETURNS jsonb LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog/,
  );
  assert.match(
    normalizedSql,
    /REVOKE ALL ON FUNCTION public\.grainline_case_open\(text, text, text, text\) FROM PUBLIC, grainline_app_runtime/,
  );
  assert.match(
    normalizedSql,
    /GRANT EXECUTE ON FUNCTION public\.grainline_case_open\(text, text, text, text\) TO grainline_app_runtime/,
  );
  assert.doesNotMatch(body, /\bEXECUTE\b/i);
  assert.doesNotMatch(body, /\bformat\s*\(/i);
});

test("Case-open authority locks actor then exact Order and stabilizes seller sources", () => {
  const actorLock = normalizedSql.indexOf(
    'FROM public."User" AS actor WHERE actor.id = p_actor_user_id FOR SHARE',
  );
  const orderLock = normalizedSql.indexOf(
    'FROM public."Order" AS orders WHERE orders.id = p_order_id FOR UPDATE',
  );
  const sellerGraphLock = normalizedSql.indexOf(
    "FOR SHARE OF item, listing, seller",
  );
  const caseLock = normalizedSql.indexOf(
    'FROM public."Case" AS case_row WHERE case_row."orderId" = locked_order.id FOR UPDATE',
  );
  assert.ok(actorLock >= 0);
  assert.ok(orderLock > actorLock);
  assert.ok(sellerGraphLock > orderLock);
  assert.ok(caseLock > sellerGraphLock);
  assert.match(
    normalizedSql,
    /count\(DISTINCT source\.seller_user_id\)::integer/,
  );
  assert.match(
    normalizedSql,
    /item_count < 1 OR seller_count <> 1 OR only_seller_user_id IS NULL OR only_seller_user_id = locked_actor\.id/,
  );
});

test("Case-open authority derives clock, ids, seller, hashes, and immutable artifacts", () => {
  assert.match(
    normalizedSql,
    /description_sha256 := pg_catalog\.encode\( pg_catalog\.sha256\(pg_catalog\.convert_to\(p_description, 'UTF8'\)\), 'hex' \)/,
  );
  assert.match(
    normalizedSql,
    /transition_at := pg_catalog\.timezone\( 'UTC', pg_catalog\.clock_timestamp\(\) \)/,
  );
  assert.match(
    normalizedSql,
    /target_case_id := pg_catalog\.gen_random_uuid\(\)::text/,
  );
  assert.match(
    normalizedSql,
    /target_message_id := pg_catalog\.gen_random_uuid\(\)::text/,
  );
  assert.match(normalizedSql, /INSERT INTO public\."Case"/);
  assert.match(normalizedSql, /INSERT INTO public\."CaseMessage"/);
  assert.match(
    normalizedSql,
    /INSERT INTO public\."AdminAuditLog"[\s\S]*'BUYER_OPEN_CASE'/,
  );
  assert.match(
    normalizedSql,
    /INSERT INTO public\."CaseOpenApplication"/,
  );
});

test("Case-open authority rejects unpaid, refunding, early, and expired Orders", () => {
  for (const check of [
    /locked_order\."paidAt" IS NULL/,
    /locked_order\."caseResolutionClaimId" IS NOT NULL OR locked_order\."sellerRefundId" IS NOT NULL/,
    /payment_event\."eventType" = 'REFUND'/,
    /locked_order\."labelStatus" = 'PURCHASED'::public\."LabelStatus"/,
    /locked_order\."fulfillmentStatus" = 'PENDING'::public\."FulfillmentStatus" AND NOT locked_seller\.banned/,
    /locked_order\."estimatedDeliveryDate" > transition_at AND NOT locked_seller\.banned/,
    /window_reference_at \+ INTERVAL '30 days' < transition_at/,
  ]) {
    assert.match(normalizedSql, check);
  }
});

test("Case-open replay requires matching Case, message, ledger, audit, and inputs", () => {
  assert.match(
    normalizedSql,
    /existing_case_found := FOUND[\s\S]*existing_application_found := FOUND/,
  );
  assert.match(
    normalizedSql,
    /existing_application\."descriptionSha256" IS DISTINCT FROM description_sha256/,
  );
  assert.match(
    normalizedSql,
    /opening_message\.body IS DISTINCT FROM p_description/,
  );
  assert.match(
    normalizedSql,
    /opening_audit\.action IS DISTINCT FROM 'BUYER_OPEN_CASE'/,
  );
  assert.match(
    normalizedSql,
    /opening_audit\.metadata->>'openingMessageId' IS DISTINCT FROM existing_application\."openingMessageId"/,
  );
  assert.match(
    normalizedSql,
    /existing_case\."createdAt" IS DISTINCT FROM existing_application\."createdAt"/,
  );
  assert.match(
    normalizedSql,
    /opening_message\."createdAt" IS DISTINCT FROM existing_application\."createdAt"/,
  );
  assert.match(
    normalizedSql,
    /opening_audit\."createdAt" IS DISTINCT FROM existing_application\."createdAt"/,
  );
  assert.match(
    normalizedSql,
    /'action', 'replay'/,
  );
  const replayResult = normalizedSql.match(
    /RETURN pg_catalog\.jsonb_build_object\( 'caseId', existing_case\.id,[\s\S]*?'action', 'replay' \)/,
  )?.[0];
  assert.ok(replayResult, "replay result projection is missing");
  assert.equal(
    replayResult.match(/'status'/g)?.length,
    1,
    "replay result must project status exactly once",
  );
});

test("schema records the private replay ledger without exposing an access model", () => {
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /model CaseOpenApplication \{/);
  assert.match(schema, /@@unique\(\[caseId, orderId\]\)/);
  assert.match(schema, /caseOpenApplication\s+CaseOpenApplication\?/);
  assert.match(schema, /openApplication\s+CaseOpenApplication\?/);
  assert.match(schema, /openingApplication\s+CaseOpenApplication\?/);
});

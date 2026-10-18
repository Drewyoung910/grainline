#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DISPUTE_FIRST_EVENT_CASE_MIGRATION =
  "20261017010000_correct_dispute_first_event_case";

const PREDECESSORS = Object.freeze({
  dispute: Object.freeze({
    migration: "20261016011000_correct_case_refund_followup_deadends",
    isolatedPathEnvironment: "CASE_REFUND_FOLLOWUP_MIGRATION_PATH",
    sha256: "71ae9d866d67b181b28cb0eca1ede74e032ac7c57de398bde95a9e6d95b7619e",
    signature:
      "CREATE OR REPLACE FUNCTION public.grainline_order_payment_signed_dispute_apply(",
    delimiter: "$grainline_order_payment_signed_dispute_apply$;",
  }),
  caseApply: Object.freeze({
    migration: "20260901160000_correct_case_order_invariants",
    sha256: "aaaf788a42d493c7cf77471cafa2b1ee69690c279df15574cef9d4b91547265e",
    signature:
      "CREATE OR REPLACE FUNCTION public.grainline_case_stripe_dispute_apply(",
    delimiter: "$grainline_case_stripe_dispute_apply$;",
  }),
  relationship: Object.freeze({
    migration: "20260730010000_enforce_case_message_invariants",
    sha256: "4557c044740a6cee0d30b78ebe1d9bb300b43613cf979fba01d2571e3c4d1fa1",
    signature: "CREATE FUNCTION public.grainline_case_relationship_valid()",
    delimiter: "$grainline_case_relationship_valid$;",
  }),
  notification: Object.freeze({
    migration: "20261013200000_move_final_seller_private_sql_callers",
    predecessorDirectoryEnvironment:
      "SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATIONS_DIR",
    sha256: "9293316672717416574d53b485b8af9d16b0757801633b493696a24329362064",
    signature:
      "CREATE OR REPLACE FUNCTION public.grainline_notification_create_core(",
    delimiter: "$grainline_notification_create_core$;",
  }),
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label} predecessor text is missing`);
  assert.equal(
    source.indexOf(before, first + before.length),
    -1,
    `${label} predecessor text is ambiguous`,
  );
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function extractDefinition(rootDirectory, predecessor) {
  const isolatedPath = predecessor.isolatedPathEnvironment
    ? process.env[predecessor.isolatedPathEnvironment]?.trim()
    : "";
  const isolatedDirectory = predecessor.predecessorDirectoryEnvironment
    ? process.env[predecessor.predecessorDirectoryEnvironment]?.trim()
    : "";
  const migrationPath = isolatedPath || path.join(
    isolatedDirectory || path.join(rootDirectory, "prisma/migrations"),
    predecessor.migration,
    "migration.sql",
  );
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.equal(
    sha256(migration),
    predecessor.sha256,
    `${predecessor.migration} checksum drifted`,
  );
  const start = migration.indexOf(predecessor.signature);
  const end = migration.indexOf(predecessor.delimiter, start);
  assert.ok(start >= 0 && end >= 0, `${predecessor.migration} function is missing`);
  return migration.slice(start, end + predecessor.delimiter.length);
}

export function buildDisputeFirstEventCaseCorrection(rootDirectory = process.cwd()) {
  let relationship = extractDefinition(rootDirectory, PREDECESSORS.relationship);
  relationship = replaceExactlyOnce(
    relationship,
    "CREATE FUNCTION public.grainline_case_relationship_valid()",
    "CREATE OR REPLACE FUNCTION public.grainline_case_relationship_valid()",
    "Case relationship replacement",
  );
  relationship = replaceExactlyOnce(
    relationship,
    `    SELECT\n      event."eventType",`,
    `    SELECT\n      event.id,\n      event."eventType",`,
    "Case relationship source event identity",
  );
  relationship = replaceExactlyOnce(
    relationship,
    `       OR dispute_event.metadata->>'stripeEventType'\n            IS DISTINCT FROM 'charge.dispute.created'`,
    `       OR dispute_event.metadata->>'stripeEventType' IS NULL\n       OR dispute_event.metadata->>'stripeEventType' NOT IN (\n            'charge.dispute.created',\n            'charge.dispute.updated',\n            'charge.dispute.closed',\n            'charge.dispute.funds_withdrawn',\n            'charge.dispute.funds_reinstated'\n          )`,
    "Case relationship dispute event family",
  );
  relationship = replaceExactlyOnce(
    relationship,
    `       OR order_stripe_charge_id IS NULL`,
    `       OR dispute_event.metadata->>'orderingAction'\n            IS DISTINCT FROM 'applied'\n       OR (\n         NOT EXISTS (\n           SELECT 1\n             FROM public."CaseStripeDisputeApplication" AS exact_application\n            WHERE exact_application."paymentEventId"\n                    = NEW."openedByPaymentEventId"\n              AND exact_application."caseId" = NEW.id\n              AND exact_application."orderId" = NEW."orderId"\n              AND exact_application.action IN ('create', 'reopen')\n         )\n         AND EXISTS (\n           SELECT 1\n             FROM public."CaseStripeDisputeApplication" AS prior_application\n             JOIN public."OrderPaymentEvent" AS applied_event\n               ON applied_event.id = prior_application."paymentEventId"\n            WHERE prior_application."orderId" = NEW."orderId"\n              AND applied_event."orderId" = NEW."orderId"\n              AND applied_event."eventType" = 'DISPUTE'\n              AND applied_event."stripeObjectType" = 'dispute'\n              AND applied_event."stripeObjectId"\n                    IS NOT DISTINCT FROM dispute_event."stripeObjectId"\n         )\n       )\n       OR order_stripe_charge_id IS NULL`,
    "Case relationship first non-created event boundary",
  );

  let caseApply = extractDefinition(rootDirectory, PREDECESSORS.caseApply);
  caseApply = replaceExactlyOnce(
    caseApply,
    `     OR source_event.metadata->>'stripeEventType'\n          IS DISTINCT FROM 'charge.dispute.created'`,
    `     OR source_event.metadata->>'stripeEventType' IS NULL\n     OR source_event.metadata->>'stripeEventType' NOT IN (\n          'charge.dispute.created',\n          'charge.dispute.updated',\n          'charge.dispute.closed',\n          'charge.dispute.funds_withdrawn',\n          'charge.dispute.funds_reinstated'\n        )`,
    "Case authority dispute event family",
  );
  caseApply = replaceExactlyOnce(
    caseApply,
    `     OR source_event.metadata->>'chargeId'\n          IS DISTINCT FROM locked_order."stripeChargeId"`,
    `     OR source_event.metadata->>'orderingAction'\n          IS DISTINCT FROM 'applied'\n     OR (\n       NOT EXISTS (\n         SELECT 1\n           FROM public."CaseStripeDisputeApplication" AS exact_application\n          WHERE exact_application."paymentEventId" = source_event.id\n            AND exact_application."orderId" = locked_order.id\n            AND exact_application.action IN ('create', 'reopen')\n       )\n       AND EXISTS (\n         SELECT 1\n           FROM public."CaseStripeDisputeApplication" AS prior_application\n           JOIN public."OrderPaymentEvent" AS applied_event\n             ON applied_event.id = prior_application."paymentEventId"\n          WHERE prior_application."orderId" = locked_order.id\n            AND applied_event."orderId" = locked_order.id\n            AND applied_event."eventType" = 'DISPUTE'\n            AND applied_event."stripeObjectType" = 'dispute'\n            AND applied_event."stripeObjectId"\n                  IS NOT DISTINCT FROM source_event."stripeObjectId"\n       )\n     )\n     OR source_event.metadata->>'chargeId'\n          IS DISTINCT FROM locked_order."stripeChargeId"`,
    "Case authority first non-created event boundary",
  );

  let dispute = extractDefinition(rootDirectory, PREDECESSORS.dispute);
  dispute = replaceExactlyOnce(
    dispute,
    "  should_apply boolean := false;\n",
    "  should_apply boolean := false;\n  is_first_dispute_event boolean := false;\n",
    "first dispute event declaration",
  );
  dispute = replaceExactlyOnce(
    dispute,
    `  IF NOT FOUND THEN\n    result_action := 'applied';\n    should_apply := true;`,
    `  IF NOT FOUND THEN\n    result_action := 'applied';\n    should_apply := true;\n    is_first_dispute_event := true;`,
    "first dispute event classification",
  );
  dispute = replaceExactlyOnce(
    dispute,
    `         OR equal_payment.reason IS DISTINCT FROM normalized_reason\n         OR (\n           source_event.type = 'charge.dispute.created'\n           AND equal_payment.metadata->>'stripeEventType'\n                 IS DISTINCT FROM source_event.type\n           AND NOT EXISTS (\n             SELECT 1\n               FROM public."Case" AS case_row\n              WHERE case_row."orderId" = source_order.id\n           )\n         )\n       )`,
    `         OR equal_payment.reason IS DISTINCT FROM normalized_reason\n       )`,
    "temporary same-second created-event guard",
  );
  dispute = replaceExactlyOnce(
    dispute,
    "    IF source_event.type = 'charge.dispute.created' THEN",
    `    IF (\n         source_event.type = 'charge.dispute.created'\n         OR (is_first_dispute_event AND NOT is_terminal)\n       )\n       AND NOT EXISTS (\n         SELECT 1\n           FROM public."CaseStripeDisputeApplication" AS prior_application\n           JOIN public."OrderPaymentEvent" AS applied_event\n             ON applied_event.id = prior_application."paymentEventId"\n          WHERE prior_application."orderId" = source_order.id\n            AND applied_event."orderId" = source_order.id\n            AND applied_event."eventType" = 'DISPUTE'\n            AND applied_event."stripeObjectType" = 'dispute'\n            AND applied_event."stripeObjectId" = p_dispute_id\n       ) THEN`,
    "first nonterminal dispute Case application",
  );

  let notification = extractDefinition(rootDirectory, PREDECESSORS.notification);
  notification = replaceExactlyOnce(
    notification,
    `         (source_payment."eventType" = 'DISPUTE'\n          AND source_payment.metadata ->> 'stripeEventType' = 'charge.dispute.created'`,
    `         (source_payment."eventType" = 'DISPUTE'\n          AND source_payment.metadata ->> 'stripeEventType' IN (\n            'charge.dispute.created',\n            'charge.dispute.updated',\n            'charge.dispute.closed',\n            'charge.dispute.funds_withdrawn',\n            'charge.dispute.funds_reinstated'\n          )`,
    "dispute notification event family",
  );
  notification = replaceExactlyOnce(
    notification,
    `          AND p_type = 'PAYMENT_DISPUTE'::public."NotificationType"\n          AND EXISTS (\n            SELECT 1\n              FROM public."SystemAuditLog" AS dispute_audit`,
    `          AND p_type = 'PAYMENT_DISPUTE'::public."NotificationType"\n          AND EXISTS (\n            SELECT 1\n              FROM public."CaseStripeDisputeApplication" AS dispute_application\n             WHERE dispute_application."paymentEventId" = source_payment.id\n               AND dispute_application."orderId" = source_order.id\n               AND dispute_application.action IN ('create', 'reopen')\n          )\n          AND EXISTS (\n            SELECT 1\n              FROM public."SystemAuditLog" AS dispute_audit`,
    "dispute notification Case application authority",
  );

  const catalogSnapshot = `CREATE TEMP TABLE
  grainline_dispute_first_event_case_catalog_before
ON COMMIT DROP
AS
SELECT
  routine.oid,
  routine.proowner,
  routine.prosecdef,
  routine.provolatile,
  routine.proparallel,
  routine.proconfig,
  routine.proacl
FROM pg_catalog.pg_proc AS routine
WHERE routine.oid IN (
  pg_catalog.to_regprocedure('public.grainline_case_relationship_valid()'),
  pg_catalog.to_regprocedure('public.grainline_case_stripe_dispute_apply(text)'),
  pg_catalog.to_regprocedure(
    'public.grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)'
  ),
  pg_catalog.to_regprocedure(
    'public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)'
  )
);

DO $grainline_dispute_first_event_case_catalog_preflight$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
      FROM grainline_dispute_first_event_case_catalog_before
  ) <> 4 THEN
    RAISE EXCEPTION 'Dispute first-event predecessor catalog is incomplete';
  END IF;
END;
$grainline_dispute_first_event_case_catalog_preflight$;`;

  const catalogVerification = `DO $grainline_dispute_first_event_case_catalog_verify$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM grainline_dispute_first_event_case_catalog_before AS before
      JOIN pg_catalog.pg_proc AS after ON after.oid = before.oid
     WHERE after.proowner IS DISTINCT FROM before.proowner
        OR after.prosecdef IS DISTINCT FROM before.prosecdef
        OR after.provolatile IS DISTINCT FROM before.provolatile
        OR after.proparallel IS DISTINCT FROM before.proparallel
        OR after.proconfig IS DISTINCT FROM before.proconfig
        OR after.proacl IS DISTINCT FROM before.proacl
  ) THEN
    RAISE EXCEPTION 'Dispute first-event function catalog posture changed';
  END IF;
END;
$grainline_dispute_first_event_case_catalog_verify$;`;

  const recovery = `CREATE TEMP TABLE
  pg_temp.grainline_dispute_first_event_case_candidates
ON COMMIT DROP
AS
SELECT DISTINCT ON (
  payment."orderId",
  payment."stripeObjectId"
)
  payment.id AS payment_event_id,
  payment."orderId" AS order_id,
  payment."stripeEventId" AS stripe_event_id,
  payment."stripeObjectId" AS dispute_id,
  orders."buyerId" AS buyer_user_id,
  seller."userId" AS seller_user_id,
  COALESCE(
    payment."stripeEventCreatedSeconds",
    (payment.metadata->>'stripeEventCreated')::bigint
  ) AS event_created_seconds
FROM public."OrderPaymentEvent" AS payment
JOIN public."Order" AS orders
  ON orders.id = payment."orderId"
JOIN public."SellerProfile" AS seller
  ON seller.id = orders."sellerProfileId"
WHERE payment."eventType" = 'DISPUTE'
  AND payment."stripeObjectType" = 'dispute'
  AND payment."stripeObjectId" IS NOT NULL
  AND payment."stripeEventId" IS NOT NULL
  AND pg_catalog.jsonb_typeof(payment.metadata) = 'object'
  AND payment.metadata->>'stripeEventType' IN (
    'charge.dispute.created',
    'charge.dispute.updated',
    'charge.dispute.closed',
    'charge.dispute.funds_withdrawn',
    'charge.dispute.funds_reinstated'
  )
  AND payment.metadata->>'orderingAction' = 'applied'
  AND payment.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
  AND pg_catalog.lower(COALESCE(payment.status, '')) NOT IN (
    'won', 'lost', 'prevented', 'warning_closed'
  )
  AND NOT EXISTS (
    SELECT 1
      FROM public."CaseStripeDisputeApplication" AS prior_application
      JOIN public."OrderPaymentEvent" AS applied_event
        ON applied_event.id = prior_application."paymentEventId"
     WHERE prior_application."orderId" = payment."orderId"
       AND applied_event."orderId" = payment."orderId"
       AND applied_event."eventType" = 'DISPUTE'
       AND applied_event."stripeObjectType" = 'dispute'
       AND applied_event."stripeObjectId"
             IS NOT DISTINCT FROM payment."stripeObjectId"
  )
  AND NOT EXISTS (
    SELECT 1
      FROM public."OrderPaymentEvent" AS newer_event
     WHERE newer_event."orderId" = payment."orderId"
       AND newer_event."eventType" = 'DISPUTE'
       AND newer_event."stripeObjectType" = 'dispute'
       AND newer_event."stripeObjectId"
             IS NOT DISTINCT FROM payment."stripeObjectId"
       AND pg_catalog.jsonb_typeof(newer_event.metadata) = 'object'
       AND newer_event.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
       AND (
         (newer_event.metadata->>'stripeEventCreated')::bigint
           > (payment.metadata->>'stripeEventCreated')::bigint
         OR (
           (newer_event.metadata->>'stripeEventCreated')::bigint
             = (payment.metadata->>'stripeEventCreated')::bigint
           AND pg_catalog.lower(COALESCE(newer_event.status, '')) IN (
             'won', 'lost', 'prevented', 'warning_closed'
           )
         )
       )
  )
ORDER BY
  payment."orderId",
  payment."stripeObjectId",
  COALESCE(
    payment."stripeEventCreatedSeconds",
    (payment.metadata->>'stripeEventCreated')::bigint
  ) DESC,
  payment."createdAt" DESC,
  payment.id DESC;

DO $grainline_dispute_first_event_case_recovery$
DECLARE
  candidate record;
  application record;
  notification_id text;
  candidate_count bigint;
BEGIN
  SELECT pg_catalog.count(*)
    INTO candidate_count
    FROM pg_temp.grainline_dispute_first_event_case_candidates;

  IF candidate_count > 100 THEN
    RAISE EXCEPTION
      'Dispute first-event recovery candidate cap exceeded: %',
      candidate_count;
  END IF;

  FOR candidate IN
    SELECT candidates.*
      FROM pg_temp.grainline_dispute_first_event_case_candidates AS candidates
     ORDER BY candidates.order_id, candidates.dispute_id
  LOOP
    SELECT recovered.*
      INTO application
      FROM public.grainline_case_stripe_dispute_apply(
        candidate.payment_event_id
      ) AS recovered;

    IF NOT FOUND
       OR application."orderId" IS DISTINCT FROM candidate.order_id
       OR application."sellerUserId" IS DISTINCT FROM candidate.seller_user_id
       OR application."buyerUserId" IS DISTINCT FROM candidate.buyer_user_id
       OR application."paymentEventId"
            IS DISTINCT FROM candidate.payment_event_id
       OR application.action NOT IN ('create', 'reopen', 'replay') THEN
      RAISE EXCEPTION 'Dispute first-event Case recovery result is invalid';
    END IF;

    IF application.action IN ('create', 'reopen') THEN
      SELECT public.grainline_notification_create_core(
        pg_catalog.gen_random_uuid()::text,
        candidate.seller_user_id,
        'PAYMENT_DISPUTE'::public."NotificationType",
        'order_payment',
        candidate.stripe_event_id,
        candidate.buyer_user_id
      ) INTO notification_id;
    END IF;
  END LOOP;
END;
$grainline_dispute_first_event_case_recovery$;`;

  return `-- Audit #662: preserve the seller Case and alert when a signed Stripe\n-- dispute event arrives before charge.dispute.created. A first nonterminal signed\n-- observation now opens or reopens the Case. A terminal-first observation remains\n-- ledger-only; only a later created delivery retains predecessor recovery behavior.\n-- Event type is not provider state, so\n-- it no longer makes otherwise identical same-second observations conflict.\n\nBEGIN;\n\n${catalogSnapshot}\n\n${relationship}\n\n${caseApply}\n\n${dispute}\n\n${notification}\n\n${recovery}\n\nREVOKE ALL ON FUNCTION public.grainline_case_relationship_valid()\n  FROM PUBLIC, grainline_app_runtime;\n\nREVOKE ALL ON FUNCTION public.grainline_case_stripe_dispute_apply(text)\n  FROM PUBLIC, grainline_app_runtime;\nGRANT EXECUTE ON FUNCTION public.grainline_case_stripe_dispute_apply(text)\n  TO grainline_app_runtime;\n\nREVOKE ALL ON FUNCTION\n  public.grainline_order_payment_signed_dispute_apply(\n    text, bigint, text, text, bigint, integer, text, text, text\n  ) FROM PUBLIC, grainline_app_runtime;\nGRANT EXECUTE ON FUNCTION\n  public.grainline_order_payment_signed_dispute_apply(\n    text, bigint, text, text, bigint, integer, text, text, text\n  ) TO grainline_app_runtime;\n\nREVOKE ALL ON FUNCTION public.grainline_notification_create_core(\n  text, text, public.\"NotificationType\", text, text, text\n) FROM PUBLIC, grainline_app_runtime;\n\n${catalogVerification}\n\nCOMMENT ON FUNCTION\n  public.grainline_order_payment_signed_dispute_apply(\n    text, bigint, text, text, bigint, integer, text, text, text\n  ) IS\n  'Records signed Stripe dispute ordering, applies a first nonterminal observation, and preserves created-event recovery after a terminal first observation.';\n\nDO $grainline_dispute_first_event_case_verify$\nDECLARE\n  relationship_oid oid := pg_catalog.to_regprocedure(\n    'public.grainline_case_relationship_valid()'\n  );\n  case_oid oid := pg_catalog.to_regprocedure(\n    'public.grainline_case_stripe_dispute_apply(text)'\n  );\n  dispute_oid oid := pg_catalog.to_regprocedure(\n    'public.grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)'\n  );\n  relationship_definition text;\n  case_definition text;\n  dispute_definition text;\nBEGIN\n  IF relationship_oid IS NULL OR case_oid IS NULL OR dispute_oid IS NULL THEN\n    RAISE EXCEPTION 'Dispute first-event Case functions are missing';\n  END IF;\n\n  SELECT pg_catalog.pg_get_functiondef(routine.oid)\n    INTO relationship_definition\n    FROM pg_catalog.pg_proc AS routine\n   WHERE routine.oid = relationship_oid;\n  SELECT pg_catalog.pg_get_functiondef(routine.oid)\n    INTO case_definition\n    FROM pg_catalog.pg_proc AS routine\n   WHERE routine.oid = case_oid;\n  SELECT pg_catalog.pg_get_functiondef(routine.oid)\n    INTO dispute_definition\n    FROM pg_catalog.pg_proc AS routine\n   WHERE routine.oid = dispute_oid;\n\n  IF relationship_definition NOT LIKE '%charge.dispute.funds_withdrawn%'\n     OR relationship_definition NOT LIKE '%orderingAction%applied%'\n     OR case_definition NOT LIKE '%charge.dispute.funds_withdrawn%'\n     OR case_definition NOT LIKE '%exact_application%prior_application%'\n     OR dispute_definition NOT LIKE '%is_first_dispute_event AND NOT is_terminal%'\n     OR dispute_definition LIKE '%equal_payment.metadata->>''stripeEventType''%IS DISTINCT FROM source_event.type%'\n     OR NOT (\n       SELECT routine.prosecdef\n         FROM pg_catalog.pg_proc AS routine\n        WHERE routine.oid = relationship_oid\n     )\n     OR NOT (\n       SELECT routine.prosecdef\n         FROM pg_catalog.pg_proc AS routine\n        WHERE routine.oid = case_oid\n     )\n     OR NOT (\n       SELECT routine.prosecdef\n         FROM pg_catalog.pg_proc AS routine\n        WHERE routine.oid = dispute_oid\n     )\n     OR (\n       SELECT routine.proconfig\n         FROM pg_catalog.pg_proc AS routine\n        WHERE routine.oid = relationship_oid\n     ) IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]\n     OR (\n       SELECT routine.proconfig\n         FROM pg_catalog.pg_proc AS routine\n        WHERE routine.oid = case_oid\n     ) IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]\n     OR (\n       SELECT routine.proconfig\n         FROM pg_catalog.pg_proc AS routine\n        WHERE routine.oid = dispute_oid\n     ) IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]\n     OR pg_catalog.has_function_privilege(\n       'grainline_app_runtime', relationship_oid, 'EXECUTE'\n     )\n     OR NOT pg_catalog.has_function_privilege(\n       'grainline_app_runtime', case_oid, 'EXECUTE'\n     )\n     OR NOT pg_catalog.has_function_privilege(\n       'grainline_app_runtime', dispute_oid, 'EXECUTE'\n     )\n     OR EXISTS (\n       SELECT 1\n         FROM pg_catalog.pg_proc AS routine,\n              LATERAL pg_catalog.aclexplode(\n                COALESCE(\n                  routine.proacl,\n                  pg_catalog.acldefault('f', routine.proowner)\n                )\n              ) AS acl\n        WHERE routine.oid IN (relationship_oid, case_oid, dispute_oid)\n          AND acl.grantee = 0\n          AND acl.privilege_type = 'EXECUTE'\n     ) THEN\n    RAISE EXCEPTION 'Dispute first-event Case catalog drifted';\n  END IF;\nEND;\n$grainline_dispute_first_event_case_verify$;\n\nCOMMIT;\n`;
}

export function verifyDisputeFirstEventCaseCorrection(rootDirectory = process.cwd()) {
  const expected = buildDisputeFirstEventCaseCorrection(rootDirectory);
  const migrationPath =
    process.env.DISPUTE_FIRST_EVENT_CASE_MIGRATION_PATH?.trim() || path.join(
    rootDirectory,
    "prisma/migrations",
    DISPUTE_FIRST_EVENT_CASE_MIGRATION,
    "migration.sql",
  );
  assert.ok(fs.existsSync(migrationPath), "dispute first-event migration is missing");
  const actual = fs.readFileSync(migrationPath, "utf8");
  assert.equal(actual, expected, "dispute first-event migration bytes drifted");
  return Object.freeze({ migrationPath, sha256: sha256(actual) });
}

function main() {
  const rootDirectory = process.cwd();
  const outputPath = path.join(
    rootDirectory,
    "prisma/migrations",
    DISPUTE_FIRST_EVENT_CASE_MIGRATION,
    "migration.sql",
  );
  const expected = buildDisputeFirstEventCaseCorrection(rootDirectory);
  if (process.argv.includes("--write")) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, expected, "utf8");
  } else if (process.argv.includes("--verify")) {
    process.stdout.write(`${JSON.stringify(verifyDisputeFirstEventCaseCorrection(rootDirectory))}\n`);
  } else {
    process.stdout.write(`${sha256(expected)}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BLOCKED_CHECKOUT_REFUND_RECOVERY_MIGRATION =
  "20261015040000_repair_blocked_checkout_refund_recovery";
export const CHECKOUT_PREDECESSOR_MIGRATION =
  "20261015030000_preserve_blocked_checkout_refund_witness";
export const RECONCILIATION_PREDECESSOR_MIGRATION =
  "20260824040000_prepare_order_refund_reconciliation_authority";

const CHECKOUT_FUNCTION = "grainline_stripe_checkout_order_existing";
const RECONCILIATION_FUNCTION =
  "grainline_blocked_checkout_refund_reconciliation_record";

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label} predecessor shape drifted`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

export function functionStatement(sql, name) {
  const markers = [
    `CREATE OR REPLACE FUNCTION public.${name}(`,
    `CREATE FUNCTION public.${name}(`,
  ];
  const starts = markers
    .map((marker) => sql.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  if (starts.length !== 1) throw new Error(`Expected one ${name} definition`);
  const start = starts[0];
  const source = sql.slice(start);
  const delimiterMatch = source.match(/\nAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/u);
  if (!delimiterMatch) throw new Error(`Missing ${name} function delimiter`);
  const delimiter = delimiterMatch[1];
  const bodyStart = start + delimiterMatch.index + delimiterMatch[0].length;
  const end = sql.indexOf(`${delimiter};`, bodyStart);
  if (end <= bodyStart) throw new Error(`Missing ${name} function terminator`);
  return sql
    .slice(start, end + delimiter.length + 1)
    .replace(/^CREATE FUNCTION/u, "CREATE OR REPLACE FUNCTION");
}

export function functionBodyMd5(statement) {
  const delimiterMatch = statement.match(/\nAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/u);
  if (!delimiterMatch) throw new Error("Missing function body delimiter");
  const delimiter = delimiterMatch[1];
  const bodyStart = delimiterMatch.index + delimiterMatch[0].length;
  const bodyEnd = statement.lastIndexOf(delimiter);
  if (bodyEnd <= bodyStart) throw new Error("Missing function body terminator");
  return createHash("md5").update(statement.slice(bodyStart, bodyEnd)).digest("hex");
}

export function buildCheckoutSuccessor(predecessor) {
  return replaceExactlyOnce(
    predecessor,
    `    IF source_order."refundClaimId" IS NOT NULL THEN
      IF source_order."paymentRefundBlocked" THEN
        outcome := 'processing';`,
    `    IF source_order."refundClaimId" IS NOT NULL THEN
      IF source_order."paymentRefundBlocked"
         AND source_order."sellerRefundId" = 'pending'
         AND source_order."refundClaimSource" = 'BLOCKED_CHECKOUT'
         AND source_order."refundClaimSourceId" = p_event_id
         AND source_order."refundClaimSourceGeneration" IS NOT NULL
         AND source_order."refundClaimSourceGeneration" <= p_claim_generation
         AND source_order."refundClaimProviderAuthorizedAt" IS NOT NULL THEN
        -- A signed charge.refunded event may set paymentRefundBlocked before
        -- the checkout event retries after a local finalize failure. Resume
        -- only the exact provider-authorized claim so the existing provider
        -- refund can be recorded; do not create another refund.
        outcome := 'retry';
      ELSIF source_order."paymentRefundBlocked" THEN
        outcome := 'processing';`,
    "checkout refund-blocked recovery",
  );
}

export function buildReconciliationSuccessor(predecessor) {
  let successor = replaceExactlyOnce(
    predecessor,
    `  record_result jsonb;
  source_now timestamp(3) without time zone :=`,
    `  record_result jsonb;
  already_recorded boolean;
  source_now timestamp(3) without time zone :=`,
    "reconciliation declaration",
  );
  successor = replaceExactlyOnce(
    successor,
    `     OR p_claim_id !~ '^order_refund_claim_[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1 THEN`,
    `     OR p_claim_id !~ '^order_refund_claim_[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_refund_id IS NULL
     OR p_refund_id !~ '^re_[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_refund_id) > 220 THEN`,
    "reconciliation provider input",
  );
  successor = replaceExactlyOnce(
    successor,
    `     OR locked_event."claimGeneration" IS DISTINCT FROM
          source_reconciliation."claimSourceGeneration"
     OR locked_event."processingStartedAt" IS NOT NULL
     OR locked_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Blocked-checkout reconciliation source event is not recoverable'
      USING ERRCODE = 'serialization_failure';
  END IF;

  record_result := public.grainline_blocked_checkout_refund_record_core(
    source_reconciliation."claimSourceId",
    source_reconciliation."claimSourceGeneration",`,
    `     OR locked_event."claimGeneration"
          < source_reconciliation."claimSourceGeneration"
     OR (
       locked_event."processingStartedAt" IS NOT NULL
       AND locked_event."processedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Blocked-checkout reconciliation source event is not recoverable'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF locked_event."claimGeneration"
       > source_reconciliation."claimSourceGeneration" THEN
    SELECT EXISTS (
      SELECT 1
        FROM public."OrderPaymentEvent" AS payment_event
       WHERE payment_event."stripeEventId"
             = 'local:blocked_checkout_refund_recorded:' || p_refund_id
    )
      INTO already_recorded;
  END IF;

  IF locked_event."claimGeneration"
       > source_reconciliation."claimSourceGeneration"
     AND NOT COALESCE(already_recorded, false) THEN
    UPDATE public."Order" AS orders
       SET "refundClaimSourceGeneration" = locked_event."claimGeneration"
     WHERE orders."refundClaimId" = p_claim_id
       AND orders."refundClaimGeneration" = p_claim_generation
       AND orders."refundClaimSource" = 'BLOCKED_CHECKOUT'
       AND orders."refundClaimSourceId" = locked_event.id
       AND orders."refundClaimSourceGeneration"
             = source_reconciliation."claimSourceGeneration"
       AND orders."refundClaimIdempotencyScope"
             = source_reconciliation."idempotencyScope"
       AND orders."refundClaimProviderAuthorizedAt" IS NOT NULL
       AND orders."stripeSessionId" = locked_event."sourceObjectId"
       AND orders."sellerRefundId" = 'pending'
       AND orders."blockedCheckoutRefundRequiredAt" IS NOT NULL
       AND orders."blockedCheckoutRefundRecordedAt" IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Blocked-checkout reconciliation generation inheritance raced'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;

  record_result := public.grainline_blocked_checkout_refund_record_core(
    locked_event.id,
    locked_event."claimGeneration",`,
    "reconciliation source generation inheritance",
  );
  successor = replaceExactlyOnce(
    successor,
    `  UPDATE public."StripeWebhookEvent" AS source_event
     SET "processedAt" = source_now,
         "processingStartedAt" = NULL,
         "lastError" = NULL,
         "updatedAt" = source_now
   WHERE source_event.id = source_reconciliation."claimSourceId"
     AND source_event."claimGeneration"
          = source_reconciliation."claimSourceGeneration"
     AND source_event."processedAt" IS NULL
     AND source_event."processingStartedAt" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blocked-checkout reconciliation completion raced'
      USING ERRCODE = 'serialization_failure';
  END IF;`,
    `  IF locked_event."processedAt" IS NULL THEN
    UPDATE public."StripeWebhookEvent" AS source_event
       SET "processedAt" = source_now,
           "processingStartedAt" = NULL,
           "lastError" = NULL,
           "updatedAt" = source_now
     WHERE source_event.id = locked_event.id
       AND source_event."claimGeneration" = locked_event."claimGeneration"
       AND source_event."processedAt" IS NULL
       AND source_event."processingStartedAt" IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Blocked-checkout reconciliation completion raced'
        USING ERRCODE = 'serialization_failure';
    END IF;
  END IF;`,
    "reconciliation processed completion",
  );
  return successor;
}

function catalogAttestation(expected, phase) {
  return `DO $grainline_blocked_checkout_refund_recovery_${phase}$
DECLARE
  order_owner oid;
  runtime_role oid;
  accepted_functions integer;
BEGIN
  SELECT table_row.relowner
    INTO order_owner
    FROM pg_catalog.pg_class AS table_row
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = table_row.relnamespace
   WHERE namespace.nspname = 'public'
     AND table_row.relname = 'Order'
     AND table_row.relkind = 'r';
  SELECT role_row.oid
    INTO runtime_role
    FROM pg_catalog.pg_roles AS role_row
   WHERE role_row.rolname = 'grainline_app_runtime';
  IF order_owner IS NULL OR runtime_role IS NULL THEN
    RAISE EXCEPTION 'Blocked-checkout refund recovery roles or Order table are missing';
  END IF;

  WITH expected(function_identity, source_md5) AS (
    VALUES
      (
        'public.grainline_stripe_checkout_order_existing(text,bigint,text)',
        '${expected.checkout}'
      ),
      (
        'public.grainline_blocked_checkout_refund_reconciliation_record(text,text,bigint,text,text,text,integer)',
        '${expected.reconciliation}'
      )
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_functions
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
   WHERE namespace.nspname = 'public'
     AND language.lanname = 'plpgsql'
     AND procedure.prokind = 'f'
     AND procedure.proowner = order_owner
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') = 0
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee <> procedure.proowner
     ) = 1
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee = runtime_role
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
     ) = 1;
  IF accepted_functions <> 2 THEN
    RAISE EXCEPTION
      'Blocked-checkout refund recovery ${phase === "preflight" ? "predecessor catalog drifted" : "postflight catalog drifted"}: accepted=%',
      accepted_functions;
  END IF;
END
$grainline_blocked_checkout_refund_recovery_${phase}$;`;
}

export function blockedCheckoutRefundRecoveryDefinitions(root = process.cwd()) {
  const migrationRoot =
    process.env.BLOCKED_CHECKOUT_REFUND_RECOVERY_PREDECESSOR_MIGRATIONS_DIR ||
    path.join(root, "prisma", "migrations");
  const checkoutPredecessor = functionStatement(
    fs.readFileSync(
      path.join(migrationRoot, CHECKOUT_PREDECESSOR_MIGRATION, "migration.sql"),
      "utf8",
    ),
    CHECKOUT_FUNCTION,
  );
  const reconciliationPredecessor = functionStatement(
    fs.readFileSync(
      path.join(
        migrationRoot,
        RECONCILIATION_PREDECESSOR_MIGRATION,
        "migration.sql",
      ),
      "utf8",
    ),
    RECONCILIATION_FUNCTION,
  );
  const checkoutSuccessor = buildCheckoutSuccessor(checkoutPredecessor);
  const reconciliationSuccessor = buildReconciliationSuccessor(
    reconciliationPredecessor,
  );
  return {
    checkoutPredecessor,
    checkoutSuccessor,
    reconciliationPredecessor,
    reconciliationSuccessor,
  };
}

export function buildBlockedCheckoutRefundRecoveryMigration(root = process.cwd()) {
  const definitions = blockedCheckoutRefundRecoveryDefinitions(root);
  const before = {
    checkout: functionBodyMd5(definitions.checkoutPredecessor),
    reconciliation: functionBodyMd5(definitions.reconciliationPredecessor),
  };
  const after = {
    checkout: functionBodyMd5(definitions.checkoutSuccessor),
    reconciliation: functionBodyMd5(definitions.reconciliationSuccessor),
  };
  return `-- Recover an exact blocked-checkout refund claim after signed refund evidence
-- blocks ordinary checkout completion, and let immutable ADMIN reconciliation
-- record a provider refund from a processed or later-generation source event.

BEGIN;

${catalogAttestation(before, "preflight")}

${definitions.checkoutSuccessor}

${definitions.reconciliationSuccessor}

REVOKE ALL ON FUNCTION public.grainline_stripe_checkout_order_existing(
  text, bigint, text
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stripe_checkout_order_existing(
  text, bigint, text
) TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
  text, text, bigint, text, text, text, integer
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
  text, text, bigint, text, text, text, integer
) TO grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
  text, text, bigint, text, text, text, integer
) IS 'Records an ADMIN-verified blocked-checkout refund after a failed, processed, or later-generation checkout event without creating another provider refund.';

${catalogAttestation(after, "postflight")}

COMMIT;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const migration = buildBlockedCheckoutRefundRecoveryMigration();
  if (process.argv.includes("--verify")) {
    const current = fs.readFileSync(
      process.env.BLOCKED_CHECKOUT_REFUND_RECOVERY_MIGRATION_PATH || path.join(
        process.cwd(),
        "prisma",
        "migrations",
        BLOCKED_CHECKOUT_REFUND_RECOVERY_MIGRATION,
        "migration.sql",
      ),
      "utf8",
    );
    if (current !== migration) {
      throw new Error("Blocked-checkout refund recovery migration bytes drifted");
    }
  } else {
    process.stdout.write(migration);
  }
}

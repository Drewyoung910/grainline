import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PREDECESSOR_MIGRATION =
  "20261001070000_prepare_case_refund_provider_recovery";
export const MIGRATION =
  "20261002020000_correct_case_refund_provider_recovery_continuity";

const predecessorPath =
  `prisma/migrations/${PREDECESSOR_MIGRATION}/migration.sql`;
const migrationPath = `prisma/migrations/${MIGRATION}/migration.sql`;

function replaceExactly(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label} replacement is not unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function extractFunction(sql, delimiter) {
  const marker = `AS ${delimiter}`;
  const markerStart = sql.indexOf(marker);
  if (markerStart < 0) throw new Error(`Missing ${delimiter}`);
  const start = sql.lastIndexOf("CREATE OR REPLACE FUNCTION", markerStart);
  const endMarker = `${delimiter};`;
  const end = sql.indexOf(endMarker, markerStart + marker.length);
  if (start < 0 || end < 0) throw new Error(`Incomplete ${delimiter}`);
  return sql.slice(start, end + endMarker.length);
}

function functionBody(definition, delimiter) {
  const marker = `AS ${delimiter}`;
  const start = definition.indexOf(marker) + marker.length;
  const end = definition.indexOf(`${delimiter};`, start);
  return definition.slice(start, end);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function buildImmutable(predecessor) {
  const delimiter = "$grainline_case_resolution_claim_immutable$";
  let definition = extractFunction(predecessor, delimiter);
  definition = replaceExactly(
    definition,
    `AS ${delimiter}\nBEGIN`,
    `AS ${delimiter}\nDECLARE\n  recovery_redelegation boolean;\n  recovery_reset boolean;\nBEGIN\n  recovery_redelegation :=\n    OLD."providerRecoveryActorId" IS NOT NULL\n    AND NEW."providerRecoveryActorId" IS NOT NULL\n    AND NEW."providerRecoveryActorId"\n          IS DISTINCT FROM OLD."providerRecoveryActorId"\n    AND NEW.status = OLD.status\n    AND NEW."providerRecoveryAction"\n          IS NOT DISTINCT FROM OLD."providerRecoveryAction"\n    AND NEW."providerRecoveryEvidenceSha256"\n          IS NOT DISTINCT FROM OLD."providerRecoveryEvidenceSha256"\n    AND NEW."providerRecoveryInspectedAt"\n          IS NOT DISTINCT FROM OLD."providerRecoveryInspectedAt"\n    AND NEW."providerRecoveryAuthorizedAt"\n          IS NOT DISTINCT FROM OLD."providerRecoveryAuthorizedAt"\n    AND NEW."providerRecoveryRecordedAt"\n          IS NOT DISTINCT FROM OLD."providerRecoveryRecordedAt"\n    AND NEW."providerRecoveryFinalizedAt" IS NULL\n    AND OLD."providerRecoveryFinalizedAt" IS NULL\n    AND EXISTS (\n      SELECT 1\n        FROM public."User" AS replacement_actor\n       WHERE replacement_actor.id = NEW."providerRecoveryActorId"\n         AND replacement_actor.role = 'ADMIN'::public."Role"\n         AND NOT replacement_actor.banned\n         AND replacement_actor."deletedAt" IS NULL\n    )\n    AND NOT EXISTS (\n      SELECT 1\n        FROM public."User" AS prior_actor\n       WHERE prior_actor.id = OLD."providerRecoveryActorId"\n         AND prior_actor.role = 'ADMIN'::public."Role"\n         AND NOT prior_actor.banned\n         AND prior_actor."deletedAt" IS NULL\n    );\n\n  recovery_reset :=\n    OLD.status = 'PROVIDER_PENDING'::public."CaseResolutionClaimStatus"\n    AND NEW.status =\n          'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"\n    AND OLD."providerRecoveryActorId" IS NOT NULL\n    AND NEW."providerRecoveryActorId" IS NULL\n    AND NEW."providerRecoveryAction" IS NULL\n    AND NEW."providerRecoveryEvidenceSha256" IS NULL\n    AND NEW."providerRecoveryInspectedAt" IS NULL\n    AND NEW."providerRecoveryAuthorizedAt" IS NULL\n    AND OLD."providerRecoveryRecordedAt" IS NULL\n    AND NEW."providerRecoveryRecordedAt" IS NULL\n    AND OLD."providerRecoveryFinalizedAt" IS NULL\n    AND NEW."providerRecoveryFinalizedAt" IS NULL;`,
    "immutable continuity declaration",
  );
  definition = replaceExactly(
    definition,
    `       OR NEW."providerRecoveryAuthorizedAt"\n         IS DISTINCT FROM OLD."providerRecoveryAuthorizedAt"\n     ) THEN`,
    `       OR NEW."providerRecoveryAuthorizedAt"\n         IS DISTINCT FROM OLD."providerRecoveryAuthorizedAt"\n     )\n     AND NOT recovery_redelegation\n     AND NOT recovery_reset THEN`,
    "immutable recovery exception",
  );
  definition = replaceExactly(
    definition,
    `      AND NEW."providerRecoveryAuthorizedAt" IS NOT NULL\n    )\n  ) THEN\n    RAISE EXCEPTION 'Invalid CaseResolutionClaim status transition'`,
    `      AND NEW."providerRecoveryAuthorizedAt" IS NOT NULL\n    )\n    OR recovery_redelegation\n  ) THEN\n    RAISE EXCEPTION 'Invalid CaseResolutionClaim status transition'`,
    "immutable redelegation transition",
  );
  return definition;
}

function buildRecoveryLoad(predecessor) {
  const delimiter =
    "$grainline_case_staff_resolution_provider_recovery_load$";
  let definition = extractFunction(predecessor, delimiter);
  definition = replaceExactly(
    definition,
    `  locked_claim record;\n  recovery_action text;`,
    `  locked_claim record;\n  prior_actor record;\n  recovery_action text;\n  transition_at timestamp(3);\n  audit_id text;`,
    "recovery-load declaration",
  );
  definition = replaceExactly(
    definition,
    `    claim."providerRecoveryActorId",\n    claim."providerRecoveryAuthorizedAt",`,
    `    claim."providerRecoveryActorId",\n    claim."providerRecoveryAction",\n    claim."providerRecoveryAuthorizedAt",`,
    "recovery-load action projection",
  );
  definition = replaceExactly(
    definition,
    `  IF locked_claim."providerRecoveryActorId" IS NOT NULL THEN\n    IF locked_claim."providerRecoveryActorId" IS DISTINCT FROM locked_actor.id\n       OR locked_claim."providerRecoveryAuthorizedAt" IS NULL\n       OR locked_claim."providerRecoveryFinalizedAt" IS NOT NULL THEN\n      RAISE EXCEPTION 'Case provider-recovery claim is already delegated'\n        USING ERRCODE = '42501';\n    END IF;\n    recovery_action := 'recovered';\n  ELSIF locked_claim."staffActorId" = locked_actor.id THEN`,
    `  IF locked_claim."providerRecoveryActorId" IS NOT NULL THEN\n    IF locked_claim."providerRecoveryActorId" IS DISTINCT FROM locked_actor.id THEN\n      SELECT actor.id, actor.role, actor.banned, actor."deletedAt"\n        INTO prior_actor\n        FROM public."User" AS actor\n       WHERE actor.id = locked_claim."providerRecoveryActorId"\n       FOR SHARE;\n      IF NOT FOUND\n         OR locked_actor.role <> 'ADMIN'::public."Role"\n         OR locked_claim."providerRecoveryAuthorizedAt" IS NULL\n         OR locked_claim."providerRecoveryFinalizedAt" IS NOT NULL\n         OR (\n           prior_actor.role = 'ADMIN'::public."Role"\n           AND NOT prior_actor.banned\n           AND prior_actor."deletedAt" IS NULL\n         ) THEN\n        RAISE EXCEPTION 'Case provider-recovery claim is already delegated'\n          USING ERRCODE = '42501';\n      END IF;\n\n      transition_at :=\n        pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());\n      UPDATE public."CaseResolutionClaim" AS claim\n         SET "providerRecoveryActorId" = locked_actor.id,\n             "updatedAt" = transition_at\n       WHERE claim.id = locked_claim.id\n         AND claim."providerRecoveryActorId" =\n               locked_claim."providerRecoveryActorId"\n         AND claim."providerRecoveryFinalizedAt" IS NULL;\n      IF NOT FOUND THEN\n        RAISE EXCEPTION 'Case provider-recovery redelegation was lost'\n          USING ERRCODE = '40001';\n      END IF;\n\n      audit_id :=\n        'case-resolution-provider-recovery-redelegate-audit:'\n        || pg_catalog.gen_random_uuid()::text;\n      INSERT INTO public."AdminAuditLog" (\n        id, "adminId", action, "targetType", "targetId", reason,\n        metadata, undone, "createdAt"\n      )\n      VALUES (\n        audit_id,\n        locked_actor.id,\n        'REDELEGATE_CASE_RESOLUTION_PROVIDER_RECOVERY',\n        'CASE_RESOLUTION_CLAIM',\n        locked_claim.id,\n        'prior_recovery_actor_inactive',\n        pg_catalog.jsonb_build_object(\n          'caseId', locked_case.id,\n          'orderId', locked_order.id,\n          'originalStaffActorId', locked_claim."staffActorId",\n          'priorRecoveryActorId', locked_claim."providerRecoveryActorId",\n          'replacementRecoveryActorId', locked_actor.id\n        ),\n        false,\n        transition_at\n      );\n      locked_claim."providerRecoveryActorId" := locked_actor.id;\n    END IF;\n    IF locked_claim."providerRecoveryAuthorizedAt" IS NULL\n       OR locked_claim."providerRecoveryFinalizedAt" IS NOT NULL THEN\n      RAISE EXCEPTION 'Case provider-recovery claim is already delegated'\n        USING ERRCODE = '42501';\n    END IF;\n    recovery_action := 'recovered';\n  ELSIF locked_claim."staffActorId" = locked_actor.id THEN`,
    "recovery-load delegation",
  );
  return definition;
}

function buildRecoveryRecord(predecessor) {
  const delimiter =
    "$grainline_case_staff_resolution_provider_recovery_record$";
  let definition = extractFunction(predecessor, delimiter);
  definition = replaceExactly(
    definition,
    `     OR p_provider_outcome IS DISTINCT FROM 'RECORDED' THEN`,
    `     OR p_provider_outcome IS NULL\n     OR p_provider_outcome NOT IN ('RECORDED', 'AMBIGUOUS') THEN`,
    "recovery-record outcome validation",
  );
  definition = replaceExactly(
    definition,
    `    UPDATE public."CaseResolutionClaim" AS claim\n       SET status =\n             'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus",\n           "updatedAt" = transition_at`,
    `    UPDATE public."CaseResolutionClaim" AS claim\n       SET status =\n             'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus",\n           "providerRecoveryActorId" = NULL,\n           "providerRecoveryAction" = NULL,\n           "providerRecoveryEvidenceSha256" = NULL,\n           "providerRecoveryInspectedAt" = NULL,\n           "providerRecoveryAuthorizedAt" = NULL,\n           "providerRecoveryRecordedAt" = NULL,\n           "providerRecoveryFinalizedAt" = NULL,\n           "updatedAt" = transition_at`,
    "recovery-record ambiguous reset",
  );
  definition = replaceExactly(
    definition,
    `    RETURN pg_catalog.jsonb_build_object(\n      'claimId', locked_claim.id,\n      'caseId', locked_case.id,\n      'orderId', locked_order.id,\n      'paymentEventId', NULL,\n      'status', 'RECONCILIATION_REQUIRED',\n      'action', 'ambiguous'\n    );`,
    `    recovery_audit_id :=\n      'case-resolution-provider-recovery-ambiguous-audit:'\n      || pg_catalog.gen_random_uuid()::text;\n    INSERT INTO public."AdminAuditLog" (\n      id, "adminId", action, "targetType", "targetId", reason,\n      metadata, undone, "createdAt"\n    )\n    VALUES (\n      recovery_audit_id,\n      locked_actor.id,\n      'RECOVER_CASE_RESOLUTION_PROVIDER_AMBIGUOUS',\n      'CASE_RESOLUTION_CLAIM',\n      locked_claim.id,\n      locked_claim."providerRecoveryAction",\n      pg_catalog.jsonb_build_object(\n        'caseId', locked_case.id,\n        'orderId', locked_order.id,\n        'originalStaffActorId', locked_claim."staffActorId",\n        'providerEvidenceSha256',\n          locked_claim."providerRecoveryEvidenceSha256",\n        'providerInspectedAt', locked_claim."providerRecoveryInspectedAt"\n      ),\n      false,\n      transition_at\n    );\n\n    RETURN pg_catalog.jsonb_build_object(\n      'claimId', locked_claim.id,\n      'caseId', locked_case.id,\n      'orderId', locked_order.id,\n      'paymentEventId', NULL,\n      'status', 'RECONCILIATION_REQUIRED',\n      'action', 'ambiguous'\n    );`,
    "recovery-record ambiguous audit",
  );
  return definition;
}

export function buildCaseRefundProviderContinuity() {
  const predecessor = readFileSync(predecessorPath, "utf8");
  const immutable = buildImmutable(predecessor);
  const recoveryLoad = buildRecoveryLoad(predecessor);
  const recoveryRecord = buildRecoveryRecord(predecessor);
  const definitions = [
    {
      identity: "public.grainline_case_resolution_claim_immutable()",
      definition: immutable,
      delimiter: "$grainline_case_resolution_claim_immutable$",
      predecessorHash:
        "a010dd797a770fdbb1c821f3e09c3717c5b517de315723e33d34f1c493f2bf7f",
      runtimeExecute: false,
      securityDefiner: false,
    },
    {
      identity:
        "public.grainline_case_staff_resolution_provider_recovery_load(text,text,public.\"CaseResolution\",integer)",
      definition: recoveryLoad,
      delimiter:
        "$grainline_case_staff_resolution_provider_recovery_load$",
      predecessorHash:
        "19b554741fce36f911cbba1dc771af88756ef02213ec9424e3ed4c8311a1ddca",
      runtimeExecute: true,
      securityDefiner: true,
    },
    {
      identity:
        "public.grainline_case_staff_resolution_provider_recovery_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)",
      definition: recoveryRecord,
      delimiter:
        "$grainline_case_staff_resolution_provider_recovery_record$",
      predecessorHash:
        "f2ff2bb23e2e0be1d35e6f4a0e91ae0575df10e7f7bcc844d50c1572a503f09d",
      runtimeExecute: true,
      securityDefiner: true,
    },
  ].map((entry) => ({
    ...entry,
    sourceHash: sha256(functionBody(entry.definition, entry.delimiter)),
  }));

  const predecessorRows = definitions.map((entry) =>
    `          ('${entry.identity}', '${entry.predecessorHash}', ${entry.runtimeExecute}, ${entry.securityDefiner})`
  ).join(",\n");
  const postflightRows = definitions.map((entry) =>
    `          ('${entry.identity}', '${entry.sourceHash}', ${entry.runtimeExecute}, ${entry.securityDefiner})`
  ).join(",\n");

  return `-- Keep recovered Case refunds retryable after a second ambiguous
-- provider result, return complete recovery state from the load function, and
-- permit an active ADMIN to take over only when the assigned recovery ADMIN
-- is no longer active. No RLS policy or table grant changes are made.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.case.refund-provider-recovery.continuity',
    0
  )
);

DO $grainline_case_refund_provider_continuity_preflight$
DECLARE
  expected record;
  function_oid oid;
  actual_hash text;
BEGIN
  FOR expected IN
    SELECT *
      FROM (
        VALUES
${predecessorRows}
      ) AS expected_functions(
        identity, source_sha256, runtime_execute, security_definer
      )
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.identity);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Case continuity predecessor function % is missing',
        expected.identity;
    END IF;
    SELECT pg_catalog.encode(
             pg_catalog.sha256(
               pg_catalog.convert_to(routine.prosrc, 'UTF8')
             ),
             'hex'
           )
      INTO actual_hash
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = function_oid
       AND routine.prosecdef = expected.security_definer
       AND routine.provolatile = 'v'
       AND routine.proparallel = 'u'
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[];
    IF actual_hash IS DISTINCT FROM expected.source_sha256
       OR pg_catalog.has_function_privilege(
            'grainline_app_runtime', function_oid, 'EXECUTE'
          ) IS DISTINCT FROM expected.runtime_execute
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_proc AS routine,
                LATERAL pg_catalog.aclexplode(
                  COALESCE(
                    routine.proacl,
                    pg_catalog.acldefault('f', routine.proowner)
                  )
                ) AS acl
          WHERE routine.oid = function_oid
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Case continuity predecessor function % drifted',
        expected.identity;
    END IF;
  END LOOP;
END
$grainline_case_refund_provider_continuity_preflight$;

${definitions.map((entry) => entry.definition).join("\n\n")}

REVOKE ALL ON FUNCTION
  public.grainline_case_resolution_claim_immutable()
  FROM PUBLIC, grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_provider_recovery_load(
    text, text, public."CaseResolution", integer
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_provider_recovery_load(
    text, text, public."CaseResolution", integer
  )
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_provider_recovery_record(
    text, text, text, text, text[], text[], text, integer, boolean, boolean
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_provider_recovery_record(
    text, text, text, text, text[], text[], text, integer, boolean, boolean
  )
  TO grainline_app_runtime;

DO $grainline_case_refund_provider_continuity_postflight$
DECLARE
  expected record;
  function_oid oid;
  actual_hash text;
BEGIN
  FOR expected IN
    SELECT *
      FROM (
        VALUES
${postflightRows}
      ) AS expected_functions(
        identity, source_sha256, runtime_execute, security_definer
      )
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.identity);
    SELECT pg_catalog.encode(
             pg_catalog.sha256(
               pg_catalog.convert_to(routine.prosrc, 'UTF8')
             ),
             'hex'
           )
      INTO actual_hash
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = function_oid
       AND routine.prosecdef = expected.security_definer
       AND routine.provolatile = 'v'
       AND routine.proparallel = 'u'
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[];
    IF function_oid IS NULL
       OR actual_hash IS DISTINCT FROM expected.source_sha256
       OR pg_catalog.has_function_privilege(
            'grainline_app_runtime', function_oid, 'EXECUTE'
          ) IS DISTINCT FROM expected.runtime_execute
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_proc AS routine,
                LATERAL pg_catalog.aclexplode(
                  COALESCE(
                    routine.proacl,
                    pg_catalog.acldefault('f', routine.proowner)
                  )
                ) AS acl
          WHERE routine.oid = function_oid
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Case continuity function % drifted', expected.identity;
    END IF;
  END LOOP;
END
$grainline_case_refund_provider_continuity_postflight$;

COMMIT;
`;
}

export function verifyCaseRefundProviderContinuityBytes() {
  return readFileSync(migrationPath, "utf8")
    === buildCaseRefundProviderContinuity();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(migrationPath, buildCaseRefundProviderContinuity(), "utf8");
}

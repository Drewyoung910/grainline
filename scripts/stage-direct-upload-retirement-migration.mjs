#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
export const DIRECT_UPLOAD_RETIREMENT_MIGRATION =
  "20260726190000_retire_direct_upload_compatibility_key";
export const DIRECT_UPLOAD_RETIREMENT_ACK =
  "I_ACKNOWLEDGE_LOOPBACK_DIRECT_UPLOAD_RETIREMENT_STAGING";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildDirectUploadRetirementCandidate() {
  const migration = `-- Generated disposable DirectUpload compatibility-key retirement candidate.
-- Do not apply outside the loopback grainline_ci proof workflow.
-- Production promotion requires compatible-app drain plus separately approved
-- aggregate legacy inspection, repair, backup and residue evidence.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.direct-upload.rls.activation', 0)
);

DO $grainline_direct_upload_retirement_preflight$
DECLARE
  direct_upload_state record;
  reference_state record;
  object_key_column record;
  direct_upload_id_column record;
  invalid_case_attachment_count integer;
  invalid_case_reference_count integer;
  invalid_lifecycle_reference_count integer;
BEGIN
  SELECT class.relrowsecurity, class.relforcerowsecurity
    INTO direct_upload_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'DirectUpload'
     AND class.relkind = 'r';
  IF NOT FOUND
     OR direct_upload_state.relrowsecurity
     OR direct_upload_state.relforcerowsecurity THEN
    RAISE EXCEPTION
      'DirectUpload retirement requires the compatible pre-activation posture';
  END IF;

  SELECT class.relrowsecurity, class.relforcerowsecurity
    INTO reference_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'DirectUploadReference'
     AND class.relkind = 'r';
  IF NOT FOUND
     OR NOT reference_state.relrowsecurity
     OR NOT reference_state.relforcerowsecurity THEN
    RAISE EXCEPTION
      'DirectUploadReference must retain ENABLE plus FORCE before retirement';
  END IF;

  SELECT
    attribute.attnotnull,
    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type_name
    INTO object_key_column
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CaseMessageAttachment'
     AND attribute.attname = 'objectKey'
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;
  IF NOT FOUND
     OR NOT object_key_column.attnotnull
     OR object_key_column.type_name IS DISTINCT FROM 'character varying(500)' THEN
    RAISE EXCEPTION
      'CaseMessageAttachment.objectKey compatibility column drifted';
  END IF;

  SELECT
    attribute.attnotnull,
    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type_name
    INTO direct_upload_id_column
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CaseMessageAttachment'
     AND attribute.attname = 'directUploadId'
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;
  IF NOT FOUND
     OR NOT direct_upload_id_column.attnotnull
     OR direct_upload_id_column.type_name IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION
      'CaseMessageAttachment.directUploadId authority column drifted';
  END IF;

  IF pg_catalog.to_regclass(
       'public."CaseMessageAttachment_objectKey_key"'
     ) IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
          'public."CaseMessageAttachment"'::pg_catalog.regclass
          AND constraint_row.conname =
            'CaseMessageAttachment_objectKey_check'
          AND constraint_row.contype = 'c'
     ) THEN
    RAISE EXCEPTION
      'CaseMessageAttachment objectKey constraints drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invalid_case_attachment_count
    FROM public."CaseMessageAttachment" AS attachment
    LEFT JOIN public."DirectUpload" AS upload
      ON upload.id = attachment."directUploadId"
   WHERE upload.id IS NULL
      OR upload.key IS DISTINCT FROM attachment."objectKey"
      OR upload."userId" IS DISTINCT FROM attachment."uploaderId"
      OR upload.endpoint IS DISTINCT FROM 'caseEvidenceImage'
      OR upload."storageClass" IS DISTINCT FROM 'PRIVATE'
      OR upload."publicUrl" IS NOT NULL
      OR upload."contentType" IS DISTINCT FROM attachment."contentType"
      OR upload."expectedSize" IS DISTINCT FROM attachment."byteSize"
      OR upload.status IS DISTINCT FROM 'CLAIMED';
  IF invalid_case_attachment_count <> 0 THEN
    RAISE EXCEPTION
      'CaseMessageAttachment compatibility identity is not exact: %',
      invalid_case_attachment_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invalid_case_reference_count
    FROM (
      SELECT attachment.id
        FROM public."CaseMessageAttachment" AS attachment
        LEFT JOIN public."DirectUploadReference" AS reference
          ON reference."directUploadId" = attachment."directUploadId"
         AND reference."sourceType" = 'CASE_MESSAGE_ATTACHMENT'
         AND reference."sourceId" = attachment.id
         AND reference."releasedAt" IS NULL
       GROUP BY attachment.id
      HAVING pg_catalog.count(reference.id) <> 1
      UNION ALL
      SELECT reference.id
        FROM public."DirectUploadReference" AS reference
        LEFT JOIN public."CaseMessageAttachment" AS attachment
          ON attachment.id = reference."sourceId"
         AND attachment."directUploadId" = reference."directUploadId"
       WHERE reference."sourceType" = 'CASE_MESSAGE_ATTACHMENT'
         AND reference."releasedAt" IS NULL
         AND attachment.id IS NULL
    ) AS invalid_case_reference;
  IF invalid_case_reference_count <> 0 THEN
    RAISE EXCEPTION
      'CaseMessageAttachment active reference identity is not exact: %',
      invalid_case_reference_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invalid_lifecycle_reference_count
    FROM public."DirectUpload" AS upload
   WHERE (
       upload.status = 'CLAIMED'
       AND NOT EXISTS (
         SELECT 1
           FROM public."DirectUploadReference" AS reference
          WHERE reference."directUploadId" = upload.id
            AND reference."releasedAt" IS NULL
       )
     )
      OR (
        upload.status <> 'CLAIMED'
        AND EXISTS (
          SELECT 1
            FROM public."DirectUploadReference" AS reference
           WHERE reference."directUploadId" = upload.id
             AND reference."releasedAt" IS NULL
        )
      )
      OR EXISTS (
        SELECT 1
          FROM public."DirectUploadReference" AS reference
         WHERE reference."directUploadId" = upload.id
           AND reference."releasedAt" IS NULL
           AND reference.exclusive IS DISTINCT FROM
             (upload."storageClass" = 'PRIVATE')
      );
  IF invalid_lifecycle_reference_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload active reference/status coherence is incomplete: %',
      invalid_lifecycle_reference_count;
  END IF;
END
$grainline_direct_upload_retirement_preflight$;

LOCK TABLE
  public."DirectUpload",
  public."DirectUploadReference",
  public."CaseMessageAttachment"
IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public."DirectUpload"
  VALIDATE CONSTRAINT "DirectUpload_userId_fkey";
ALTER TABLE public."DirectUpload"
  VALIDATE CONSTRAINT "DirectUpload_endpoint_check";
ALTER TABLE public."DirectUpload"
  VALIDATE CONSTRAINT "DirectUpload_key_endpoint_check";
ALTER TABLE public."DirectUpload"
  VALIDATE CONSTRAINT "DirectUpload_public_url_key_check";
ALTER TABLE public."DirectUpload"
  VALIDATE CONSTRAINT "DirectUpload_endpoint_storage_content_size_check";
ALTER TABLE public."DirectUpload"
  VALIDATE CONSTRAINT "DirectUpload_cleanup_lease_pair_check";

DROP TRIGGER grainline_direct_upload_case_attachment_bind
  ON public."CaseMessageAttachment";

ALTER TABLE public."CaseMessageAttachment"
  DROP CONSTRAINT "CaseMessageAttachment_objectKey_key",
  DROP CONSTRAINT "CaseMessageAttachment_objectKey_check",
  DROP COLUMN "objectKey";

CREATE OR REPLACE FUNCTION
  public.grainline_direct_upload_case_attachment_bind()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_case_attachment_bind$
DECLARE
  upload record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW."caseMessageId" IS DISTINCT FROM OLD."caseMessageId"
       OR NEW."uploaderId" IS DISTINCT FROM OLD."uploaderId"
       OR NEW."directUploadId" IS DISTINCT FROM OLD."directUploadId"
       OR NEW."contentType" IS DISTINCT FROM OLD."contentType"
       OR NEW."byteSize" IS DISTINCT FROM OLD."byteSize"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     ) THEN
    RAISE EXCEPTION 'CaseMessageAttachment identity fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    candidate."userId",
    candidate.endpoint,
    candidate."storageClass",
    candidate."publicUrl",
    candidate."contentType",
    candidate."expectedSize",
    candidate.status
    INTO upload
    FROM public."DirectUpload" AS candidate
   WHERE candidate.id = NEW."directUploadId"
   FOR UPDATE;

  IF NOT FOUND
     OR upload."userId" IS DISTINCT FROM NEW."uploaderId"
     OR upload.endpoint IS DISTINCT FROM 'caseEvidenceImage'
     OR upload."storageClass" IS DISTINCT FROM 'PRIVATE'
     OR upload."publicUrl" IS NOT NULL
     OR upload."contentType" IS DISTINCT FROM NEW."contentType"
     OR upload."expectedSize" IS DISTINCT FROM NEW."byteSize"
     OR upload.status NOT IN ('VERIFIED', 'CLAIMED') THEN
    RAISE EXCEPTION 'CaseMessageAttachment DirectUpload binding is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$grainline_direct_upload_case_attachment_bind$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_case_attachment_bind()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_direct_upload_case_attachment_bind
BEFORE INSERT OR UPDATE
ON public."CaseMessageAttachment"
FOR EACH ROW EXECUTE FUNCTION
  public.grainline_direct_upload_case_attachment_bind();

DO $grainline_direct_upload_retirement_postflight$
DECLARE
  unvalidated_constraint_count integer;
  bind_function record;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
       'public."CaseMessageAttachment"'::pg_catalog.regclass
       AND attribute.attname = 'objectKey'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION
      'CaseMessageAttachment.objectKey was not retired';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO unvalidated_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
     'public."DirectUpload"'::pg_catalog.regclass
     AND constraint_row.conname IN (
       'DirectUpload_userId_fkey',
       'DirectUpload_endpoint_check',
       'DirectUpload_key_endpoint_check',
       'DirectUpload_public_url_key_check',
       'DirectUpload_endpoint_storage_content_size_check',
       'DirectUpload_cleanup_lease_pair_check'
     )
     AND NOT constraint_row.convalidated;
  IF unvalidated_constraint_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload legacy constraints remain unvalidated: %',
      unvalidated_constraint_count;
  END IF;

  SELECT
    procedure.prosecdef,
    procedure.proleakproof,
    procedure.proconfig,
    pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
    pg_catalog.has_function_privilege(
      'grainline_app_runtime', procedure.oid, 'EXECUTE'
    ) AS runtime_execute,
    EXISTS (
      SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
    ) AS public_execute
    INTO bind_function
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = pg_catalog.to_regprocedure(
     'public.grainline_direct_upload_case_attachment_bind()'
   );
  IF NOT FOUND
     OR NOT bind_function.prosecdef
     OR bind_function.proleakproof
     OR bind_function.proconfig IS DISTINCT FROM
       ARRAY['search_path=pg_catalog']::text[]
     OR bind_function.owner_name IS DISTINCT FROM current_user
     OR bind_function.runtime_execute
     OR bind_function.public_execute THEN
    RAISE EXCEPTION
      'CaseMessageAttachment binding authority drifted after retirement';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger
     WHERE trigger.tgrelid =
       'public."CaseMessageAttachment"'::pg_catalog.regclass
       AND trigger.tgname =
         'grainline_direct_upload_case_attachment_bind'
       AND NOT trigger.tgisinternal
       AND trigger.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION
      'CaseMessageAttachment binding trigger is missing after retirement';
  END IF;
END
$grainline_direct_upload_retirement_postflight$;

COMMIT;
`;

  if (
    (migration.match(/^BEGIN;$/gm) ?? []).length !== 1
    || (migration.match(/^COMMIT;$/gm) ?? []).length !== 1
    || (migration.match(/DROP COLUMN "objectKey"/g) ?? []).length !== 1
    || (migration.match(/VALIDATE CONSTRAINT/g) ?? []).length !== 6
    || /(?:ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY/i.test(migration)
    || /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|EXECUTE)/i.test(migration)
  ) {
    throw new Error(
      "DirectUpload retirement candidate crossed its reviewed contract boundary",
    );
  }
  return Object.freeze({ migration, migrationSha256: sha256(migration) });
}

function assertDisposableTarget() {
  if (
    process.env.DIRECT_UPLOAD_RETIREMENT_STAGING_ACK
      !== DIRECT_UPLOAD_RETIREMENT_ACK
  ) {
    throw new Error(
      "disposable DirectUpload retirement acknowledgement is missing",
    );
  }
  const rawUrl = process.env.DIRECT_URL;
  if (!rawUrl) {
    throw new Error("DIRECT_URL is required for disposable retirement staging");
  }
  const parsed = new URL(rawUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || parsed.pathname !== "/grainline_ci"
  ) {
    throw new Error(
      "DirectUpload retirement may be staged only for loopback grainline_ci",
    );
  }
}

function candidatePaths() {
  const directory = path.join(
    root,
    "prisma",
    "migrations",
    DIRECT_UPLOAD_RETIREMENT_MIGRATION,
  );
  return Object.freeze({
    directory,
    migrationPath: path.join(directory, "migration.sql"),
  });
}

function stageCandidate(migration) {
  const { directory, migrationPath } = candidatePaths();
  if (fs.existsSync(directory)) {
    throw new Error(`retirement migration destination exists: ${directory}`);
  }
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  fs.writeFileSync(migrationPath, migration, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function unstageCandidate(migration) {
  const { directory, migrationPath } = candidatePaths();
  if (!fs.existsSync(directory)) {
    throw new Error("retirement migration destination does not exist");
  }
  const entries = fs.readdirSync(directory);
  if (
    entries.length !== 1
    || entries[0] !== "migration.sql"
    || !fs.statSync(migrationPath).isFile()
    || sha256(fs.readFileSync(migrationPath, "utf8")) !== sha256(migration)
  ) {
    throw new Error("refusing to remove drifted retirement migration");
  }
  fs.unlinkSync(migrationPath);
  fs.rmdirSync(directory);
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (!new Set(["--verify", "--stage", "--unstage"]).has(mode)) {
    throw new Error(
      "usage: stage-direct-upload-retirement-migration.mjs [--verify|--stage|--unstage]",
    );
  }
  const candidate = buildDirectUploadRetirementCandidate();
  if (mode !== "--verify") assertDisposableTarget();
  if (mode === "--stage") stageCandidate(candidate.migration);
  if (mode === "--unstage") unstageCandidate(candidate.migration);
  process.stdout.write(`${JSON.stringify({
    mode,
    migrationName: DIRECT_UPLOAD_RETIREMENT_MIGRATION,
    migrationSha256: candidate.migrationSha256,
    dropsCompatibilityObjectKey: true,
    validatesLegacyConstraints: 6,
    rlsChanged: false,
    grantsChanged: false,
    productionChanged: false,
    persistentStagingChanged: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch {
    process.stderr.write(
      "DirectUpload retirement staging failed closed.\n",
    );
    process.exitCode = 1;
  }
}

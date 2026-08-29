#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_PREDECESSOR =
  "20260824030000_prepare_order_payment_signed_authority";
export const ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_PREDECESSOR_SHA256 =
  "176ad2c17301dd1d6bd9a1c0e190e8d44b15463ec830f9a67eb43ec3070396f2";
export const ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION =
  "20260828020000_correct_order_payment_signed_dispute_identity";
export const ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION_SHA256 =
  "7bd8c9be14e8095f0d4952401a2331abde3149e87a4bce8a9e44235ae2ec2bcd";

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

function predecessorDisputeDefinition(rootDirectory) {
  const predecessorPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_PREDECESSOR,
    "migration.sql",
  );
  const predecessor = fs.readFileSync(predecessorPath, "utf8");
  assert.equal(
    sha256(predecessor),
    ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_PREDECESSOR_SHA256,
    "signed-dispute identity predecessor checksum drifted",
  );
  const opening =
    "CREATE FUNCTION public.grainline_order_payment_signed_dispute_apply(";
  const closing = "$grainline_order_payment_signed_dispute_apply$;";
  const start = predecessor.indexOf(opening);
  const end = predecessor.indexOf(closing, start);
  assert.ok(start >= 0 && end >= 0, "signed-dispute predecessor function is missing");
  return predecessor.slice(start, end + closing.length);
}

export function predecessorOrderPaymentSignedDisputeFunctionSource(
  rootDirectory = process.cwd(),
) {
  const definition = predecessorDisputeDefinition(rootDirectory);
  const opening = "AS $grainline_order_payment_signed_dispute_apply$";
  const closing = "$grainline_order_payment_signed_dispute_apply$;";
  const start = definition.indexOf(opening);
  const end = definition.indexOf(closing, start + opening.length);
  assert.ok(start >= 0 && end >= 0, "signed-dispute predecessor source is missing");
  return definition.slice(start + opening.length, end);
}

export function buildOrderPaymentSignedDisputeIdentityMigration(
  rootDirectory = process.cwd(),
) {
  let definition = predecessorDisputeDefinition(rootDirectory);
  definition = replaceExactlyOnce(
    definition,
    "CREATE FUNCTION public.grainline_order_payment_signed_dispute_apply(",
    "CREATE OR REPLACE FUNCTION public.grainline_order_payment_signed_dispute_apply(",
    "signed-dispute replacement",
  );
  definition = replaceExactlyOnce(
    definition,
    "     OR p_dispute_id !~ '^dp_[A-Za-z0-9]+$'\n",
    "     OR p_dispute_id !~ '^du_[A-Za-z0-9]+$'\n",
    "Stripe Dispute identifier validation",
  );

  return `-- Correct the signed Stripe Dispute identifier contract. Stripe Dispute
-- objects use the du_ prefix; the predecessor's dp_ check rejected genuine signed
-- charge.dispute.* events before any table lookup or side effect. This replacement
-- preserves the reviewed function body, authority boundary, grants and RLS posture.

BEGIN;

${definition}

REVOKE ALL ON FUNCTION
  public.grainline_order_payment_signed_dispute_apply(
    text, bigint, text, text, bigint, integer, text, text, text
  ) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_payment_signed_dispute_apply(
    text, bigint, text, text, bigint, integer, text, text, text
  ) TO grainline_app_runtime;

COMMENT ON FUNCTION
  public.grainline_order_payment_signed_dispute_apply(
    text, bigint, text, text, bigint, integer, text, text, text
  ) IS
  'Applies one genuine signed Stripe charge.dispute event whose Dispute object has the canonical du_ identifier.';

DO $grainline_signed_dispute_identity_verify$
DECLARE
  function_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)'
  );
  function_definition text;
BEGIN
  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'Signed dispute identity function is missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(routine.oid)
    INTO function_definition
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = function_oid;

  IF NOT (
       SELECT routine.prosecdef
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = function_oid
     )
     OR (
       SELECT routine.provolatile
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = function_oid
     ) IS DISTINCT FROM 'v'
     OR (
       SELECT routine.proparallel
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = function_oid
     ) IS DISTINCT FROM 'u'
     OR (
       SELECT routine.proconfig
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = function_oid
     ) IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR function_definition NOT LIKE '%p_dispute_id !~ ''^du_[A-Za-z0-9]+$''%'
     OR function_definition LIKE '%p_dispute_id !~ ''^dp_[A-Za-z0-9]+$''%'
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', function_oid, 'EXECUTE'
     )
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
    RAISE EXCEPTION 'Signed dispute identity function catalog drifted';
  END IF;
END;
$grainline_signed_dispute_identity_verify$;

COMMIT;
`;
}

export function orderPaymentSignedDisputeIdentityFunctionSource(
  rootDirectory = process.cwd(),
) {
  const migration = buildOrderPaymentSignedDisputeIdentityMigration(rootDirectory);
  const opening = "AS $grainline_order_payment_signed_dispute_apply$";
  const closing = "$grainline_order_payment_signed_dispute_apply$;";
  const start = migration.indexOf(opening);
  const end = migration.indexOf(closing, start + opening.length);
  assert.ok(start >= 0 && end >= 0, "signed-dispute identity function source is missing");
  return migration.slice(start + opening.length, end);
}

export function verifyOrderPaymentSignedDisputeIdentityMigrationBytes(
  rootDirectory = process.cwd(),
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
    "migration.sql",
  );
  const expected = buildOrderPaymentSignedDisputeIdentityMigration(rootDirectory);
  assert.ok(fs.existsSync(migrationPath), "signed-dispute identity migration is missing");
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.equal(migration, expected, "signed-dispute identity migration bytes drifted");
  assert.equal(
    sha256(migration),
    ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION_SHA256,
    "signed-dispute identity migration checksum drifted",
  );
  return Object.freeze({ migrationPath, migrationSha256: sha256(migration) });
}

function main() {
  const rootDirectory = process.cwd();
  const outputPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
    "migration.sql",
  );
  const expected = buildOrderPaymentSignedDisputeIdentityMigration(rootDirectory);
  if (process.argv.includes("--write")) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, expected, "utf8");
  } else if (process.argv.includes("--verify")) {
    verifyOrderPaymentSignedDisputeIdentityMigrationBytes(rootDirectory);
  } else {
    process.stdout.write(`${sha256(expected)}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

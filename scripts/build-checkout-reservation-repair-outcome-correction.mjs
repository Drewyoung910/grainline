import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const name = "grainline_checkout_reservation_repair_finalize";
const tag = `$${name}$`;
export const REPAIR_PREDECESSOR_DEFINITION_SHA256 =
  "d4f9132c3ba2924b5a9d453bfb96a004afed913f474311cc200b6c2cf8077ef5";

export function repairPredecessorDefinition(root = process.cwd()) {
  const sql = readFileSync(path.join(root,
    "prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql"), "utf8");
  const start = sql.indexOf(`CREATE FUNCTION public.${name}(`);
  const end = sql.indexOf(`${tag};`, start);
  assert.ok(start >= 0 && end > start, "repair predecessor function is absent");
  const definition = sql.slice(start, end + tag.length + 1);
  assert.equal(createHash("sha256").update(definition).digest("hex"),
    REPAIR_PREDECESSOR_DEFINITION_SHA256, "repair predecessor definition drifted");
  return definition;
}

function attestation(sourceMd5, phase) {
  return `DO $repair_${phase}$
BEGIN
  IF current_user <> 'neondb_owner' OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.${name}(text,bigint,text)')
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neondb_owner')
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = '${sourceMd5}'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND acl.is_grantable)
       )
  ) THEN
    RAISE EXCEPTION 'Checkout repair ${phase} function authority drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS tbl
     WHERE tbl.oid = pg_catalog.to_regclass('public."CheckoutStockReservation"')
       AND tbl.relrowsecurity AND tbl.relforcerowsecurity
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = tbl.oid)
       AND NOT pg_catalog.has_table_privilege('grainline_app_runtime', tbl.oid,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       AND NOT pg_catalog.has_any_column_privilege('grainline_app_runtime', tbl.oid,
         'SELECT,INSERT,UPDATE,REFERENCES')
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(tbl.relacl,
         pg_catalog.acldefault('r', tbl.relowner))) AS acl WHERE acl.grantee = 0)
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS col,
           LATERAL pg_catalog.aclexplode(col.attacl) AS acl
          WHERE col.attrelid = tbl.oid AND acl.grantee = 0
       )
  ) THEN
    RAISE EXCEPTION 'Checkout repair ${phase} table posture drifted';
  END IF;
END
$repair_${phase}$;`;
}

export function buildCheckoutReservationRepairOutcomeCorrection(root = process.cwd()) {
  const predecessor = repairPredecessorDefinition(root);
  const oldGuard = "OR p_outcome NOT IN (";
  assert.equal(predecessor.split(oldGuard).length, 2);
  const corrected = predecessor
    .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
    .replace(oldGuard, "OR p_outcome IS NULL OR p_outcome NOT IN (");
  const md5 = (definition) => createHash("md5").update(definition.split(tag)[1]).digest("hex");
  return `-- DRAFT: independently released CheckoutStockReservation integrity correction.
-- Reject NULL before any repair lookup, lease update, or stock restoration.
-- All six legitimate outcome branches, function ACLs and FORCE posture remain.
-- Not wired into migrations or any production workflow.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

${attestation(md5(predecessor), "before")}

${corrected}

${attestation(md5(corrected), "after")}

COMMIT;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(buildCheckoutReservationRepairOutcomeCorrection());
}

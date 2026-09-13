import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function orderLabelClawbackClockDefinition(root = process.cwd()) {
  const name = "grainline_order_label_clawback_claim_batch";
  const tag = `$${name}$`;
  const sql = readFileSync(path.join(root,
    "prisma/migrations/20260901140000_prepare_order_label_authority/migration.sql"), "utf8");
  const start = sql.indexOf(`CREATE FUNCTION public.${name}(`);
  const end = sql.indexOf(`${tag};`, start);
  assert.ok(start >= 0 && end > start);
  const before = sql.slice(start, end + tag.length + 1);
  assert.equal(createHash("sha256").update(before).digest("hex"),
    "fec69cd23ad183cfa3ce155140ed0f0cda1718abb7315ce6619d37f38c6ce7c5",
    "Label clawback clock predecessor drifted");
  const anchor = "    'attemptCount', updated.\"labelClawbackRetryCount\"";
  assert.equal(before.split(anchor).length, 2);
  const after = before.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
    .replace(anchor, `${anchor},\n    'labelPurchasedAt', updated."labelPurchasedAt" AT TIME ZONE 'UTC'`);
  return { name, tag, before, after };
}

export function buildOrderLabelClawbackClock(root = process.cwd()) {
  const definition = orderLabelClawbackClockDefinition(root);
  const attest = (phase) => {
    const md5 = createHash("md5").update(definition[phase].split(definition.tag)[1]).digest("hex");
    return `DO $label_clawback_clock_${phase}$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.${definition.name}(integer)')
       AND CURRENT_USER <> 'grainline_app_runtime'
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = '${md5}'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND (acl.is_grantable OR acl.grantor <> proc.proowner))
       )
  ) THEN
    RAISE EXCEPTION 'Label clawback clock ${phase} authority drifted';
  END IF;
END
$label_clawback_clock_${phase}$;`;
  };
  return `-- DRAFT ONLY. No migration or production workflow is wired.
-- Expose the immutable UTC purchase clock, not the resetting attempt clock.
-- Preserve claim signature, locking, counters, grants, schema and RLS posture.
-- Production packaging requires exact database, role, ledger and release checks.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

${attest("before")}

${definition.after}

${attest("after")}

COMMIT;
`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(buildOrderLabelClawbackClock());
}

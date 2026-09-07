import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const predecessors = Object.freeze([
  ["grainline_order_seller_label_provider_record",
    "text,text,text,bigint,text,text,text,text,integer,text,text,text,text",
    "3a98c10ed8f269978ad6d50897242183fcd513c4b70964922a5ec8e1ccaa593c"],
  ["grainline_order_label_clawback_finalize",
    "text,text,bigint,bigint,text,text,text",
    "333d5d8559b71bfa3a6f579e3e3922580a2dcf4813761aaec8fed23fd738fe9c"],
]);

export function orderLabelOutcomeDefinitions(root = process.cwd()) {
  const sql = readFileSync(path.join(root,
    "prisma/migrations/20260901140000_prepare_order_label_authority/migration.sql"), "utf8");
  return predecessors.map(([name, args, sha256]) => {
    const tag = `$${name}$`;
    const start = sql.indexOf(`CREATE FUNCTION public.${name}(`);
    const end = sql.indexOf(`${tag};`, start);
    assert.ok(start >= 0 && end > start, `${name} predecessor is absent`);
    const before = sql.slice(start, end + tag.length + 1);
    assert.equal(createHash("sha256").update(before).digest("hex"), sha256,
      `${name} predecessor drifted`);
    assert.equal(before.split("OR p_outcome NOT IN (").length, 2);
    const after = before.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
      .replace("OR p_outcome NOT IN (", "OR p_outcome IS NULL OR p_outcome NOT IN (");
    return { name, args, tag, before, after };
  });
}

function attest(definitions, phase) {
  return `DO $label_outcome_${phase}$
BEGIN
${definitions.map(({ name, args, tag, [phase]: definition }) => {
    const md5 = createHash("md5").update(definition.split(tag)[1]).digest("hex");
    return `  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.${name}(${args})')
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
       AND CURRENT_USER <> 'grainline_app_runtime'
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
    RAISE EXCEPTION 'Order label outcome ${phase} authority drifted: ${name}';
  END IF;`;
  }).join("\n")}
END
$label_outcome_${phase}$;`;
}

export function buildOrderLabelOutcomeCorrection(root = process.cwd()) {
  const definitions = orderLabelOutcomeDefinitions(root);
  return `-- DRAFT ONLY: no migration or production workflow is wired.
-- Add explicit NULL rejection to the two source-bound label outcome writers.
-- Preserve signatures, successful/rejected/ambiguous behavior, ACLs and table posture.
-- Production packaging must bind the exact database, role, ledger and release state.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

${attest(definitions, "before")}

${definitions.map(({ after }) => after).join("\n\n")}

${attest(definitions, "after")}

COMMIT;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(buildOrderLabelOutcomeCorrection());
}

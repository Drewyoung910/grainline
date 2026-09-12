import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const specifications = {
  refund: [
    { name: "grainline_order_refund_claim_mark_ambiguous", args: "text,bigint,text",
      migration: "20260824040000_prepare_order_refund_reconciliation_authority",
      sha256: "d626a9fcba1442e0c5cfc7647f80dc9e4c7e1a4ee8bfb1477f217c80254f4c21",
      guards: ["p_reason_code"], runtimeExecute: true },
    { name: "grainline_order_refund_reconcile", args: "text,text,bigint,text,text,bigint,text,text",
      migration: "20260824040000_prepare_order_refund_reconciliation_authority",
      sha256: "656bebec1a854abd6636fd489b4eab929eabc3087fa2a2f41613af3f8065b32f",
      guards: ["p_action", "p_provider_disposition"], runtimeExecute: true },
  ],
  notification: [
    { name: "grainline_notification_create_core", args: 'text,text,public."NotificationType",text,text,text',
      migration: "20260901120000_prepare_order_receipt_notification_authority",
      sha256: "3ac054ce8a6683553323244d68c74e1281ab9c8080c9335b1e66f6e70f3997e4",
      guards: ["p_type"], runtimeExecute: false },
  ],
};

export function orderReconciliationInputDefinitions(kind, root = process.cwd()) {
  assert.ok(Object.hasOwn(specifications, kind), "unknown input correction family");
  return specifications[kind].map((spec) => {
    const sql = readFileSync(path.join(root, "prisma/migrations", spec.migration, "migration.sql"), "utf8");
    const tag = `$${spec.name}$`;
    const start = sql.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${spec.name}\\(`));
    const end = sql.indexOf(`${tag};`, start);
    assert.ok(start >= 0 && end > start, `${spec.name} is absent`);
    const before = sql.slice(start, end + tag.length + 1);
    assert.equal(createHash("sha256").update(before).digest("hex"), spec.sha256,
      `${spec.name} predecessor drifted`);
    let after = before.replace(/^CREATE (?:OR REPLACE )?FUNCTION/, "CREATE OR REPLACE FUNCTION");
    for (const param of spec.guards) {
      const target = param === "p_type" ? "IF (p_source_type = 'blog_comment'" : `OR ${param} NOT IN (`;
      const replacement = param === "p_type" ? "IF p_type IS NULL OR (p_source_type = 'blog_comment'"
        : `OR ${param} IS NULL OR ${param} NOT IN (`;
      // Provider disposition has another branch-level NOT IN: patch only the
      // initial argument guard, keeping its legitimate branch semantics intact.
      assert.ok(after.includes(target), `${param} input guard is absent`);
      after = after.replace(target, replacement);
    }
    return { ...spec, tag, before, after };
  });
}

function attest(definitions, phase, kind) {
  return `DO $${kind}_input_${phase}$
BEGIN
${definitions.map(({ name, args, runtimeExecute, tag, [phase]: definition }) => {
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
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE') = ${runtimeExecute}
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner${runtimeExecute ? ",\n            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime')" : ""})
             OR (acl.grantee <> proc.proowner AND (acl.is_grantable OR acl.grantor <> proc.proowner))
       )
  ) THEN
    RAISE EXCEPTION '${kind} input ${phase} authority drifted: ${name}';
  END IF;`;
  }).join("\n")}
END
$${kind}_input_${phase}$;`;
}

export function buildOrderReconciliationInputCorrection(kind, root = process.cwd()) {
  const definitions = orderReconciliationInputDefinitions(kind, root);
  return `-- DRAFT ONLY: ${kind} input validation; not a staged migration or production operator.
-- Preserve all legitimate branches, signatures, ACLs and table posture.
-- Release packaging must bind the exact database, role, migration ledger and catalog.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

${attest(definitions, "before", kind)}

${definitions.map(({ after }) => after).join("\n\n")}

${attest(definitions, "after", kind)}

COMMIT;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(buildOrderReconciliationInputCorrection(process.argv[2]));
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const specs = [
  { name: "grainline_case_open", args: "text,text,text,text",
    migration: "20260729051000_prepare_case_open_authority",
    sha256: "b6c9d7d360abd8ba315be82a1de820c26501f4a43c6e940f74fd537a461131e5" },
  { name: "grainline_case_escalate", args: "text,text",
    migration: "20260729060000_prepare_case_escalation_cron_authority",
    sha256: "05ab0db1fc1ee43008328fafcdd797d7e3e9830e653e2e6723d658617ac5fdfc" },
];

export function caseLifecycleDefinitions(root = process.cwd()) {
  return specs.map((spec) => {
    const sql = readFileSync(path.join(root, "prisma/migrations", spec.migration, "migration.sql"), "utf8");
    const tag = `$${spec.name}$`;
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${spec.name}(`);
    const end = sql.indexOf(`${tag};`, start);
    assert.ok(start >= 0 && end > start);
    const before = sql.slice(start, end + tag.length + 1);
    assert.equal(createHash("sha256").update(before).digest("hex"), spec.sha256,
      `${spec.name} predecessor drifted`);
    let after = before;
    const replace = (anchor, replacement, count = 1) => {
      assert.equal(after.split(anchor).length - 1, count, `${spec.name} anchor drifted`);
      after = after.replaceAll(anchor, replacement);
    };
    if (spec.name === "grainline_case_open") {
      replace('  IF locked_order."estimatedDeliveryDate" IS NOT NULL',
        `  -- Completed handoff permits an immediate complaint even before the estimate.
  -- The independent thirty-day closing deadline below remains unchanged.
  IF locked_order."fulfillmentStatus" NOT IN (
       'DELIVERED'::public."FulfillmentStatus",
       'PICKED_UP'::public."FulfillmentStatus"
     )
     AND locked_order."estimatedDeliveryDate" IS NOT NULL`);
    } else {
      replace("NOT IN ('OPEN', 'IN_DISCUSSION')", "NOT IN ('OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE')", 2);
      replace(`       'IN_DISCUSSION'::public."CaseStatus"\n     ) THEN`,
        `       'IN_DISCUSSION'::public."CaseStatus",\n       'PENDING_CLOSE'::public."CaseStatus"\n     ) THEN`);
      replace("    IF NOT counterparty_unavailable\n       AND (",
        `    -- Available participants retain the normal reply-to-object workflow.
    -- Unavailability must not remove BOTH reply and staff-review access.
    IF locked_case.status = 'PENDING_CLOSE'::public."CaseStatus"
       AND NOT counterparty_unavailable THEN
      RAISE EXCEPTION 'Pending-close Case still has an available counterparty'
        USING ERRCODE = '23514';
    END IF;
    IF NOT counterparty_unavailable
       AND (`);
      replace(`     SET status = 'UNDER_REVIEW'::public."CaseStatus",\n         "updatedAt" = transition_at`,
        `     SET status = 'UNDER_REVIEW'::public."CaseStatus",
         "buyerMarkedResolved" = CASE
           WHEN locked_case.status = 'PENDING_CLOSE'::public."CaseStatus" THEN false
           ELSE case_row."buyerMarkedResolved" END,
         "sellerMarkedResolved" = CASE
           WHEN locked_case.status = 'PENDING_CLOSE'::public."CaseStatus" THEN false
           ELSE case_row."sellerMarkedResolved" END,
         "updatedAt" = transition_at`);
    }
    return { ...spec, tag, before, after };
  });
}

function attest(definitions, phase) {
  return `DO $case_lifecycle_${phase}$
BEGIN
${definitions.map(({ name, args, tag, [phase]: definition }) => {
    const md5 = createHash("md5").update(definition.split(tag)[1]).digest("hex");
    return `  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.${name}(${args})')
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
    RAISE EXCEPTION 'Case lifecycle ${phase} authority drifted: ${name}';
  END IF;`;
  }).join("\n")}
END
$case_lifecycle_${phase}$;`;
}

export function buildCaseLifecycleCorrection(root = process.cwd()) {
  const definitions = caseLifecycleDefinitions(root);
  return `-- DRAFT ONLY. No migration or production workflow is wired.
-- Early handoff satisfies opening; unavailable-counterparty objections reach staff.
-- Preserve signatures, ACLs, lock order, refund guards, RLS and existing deadlines.
-- Release requires exact catalog/ledger review and compatible application readers.
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
  process.stdout.write(buildCaseLifecycleCorrection());
}

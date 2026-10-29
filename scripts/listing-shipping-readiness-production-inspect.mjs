import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

export const migrationName =
  "20261027060000_enforce_listing_shipping_readiness";
export const migrationChecksum =
  "e654d44d00410d29d79505b6a6445d40d3d3fb85b5c51d5e3b85104fd15714da";

const migrationSql = readFileSync(
  `prisma/migrations/${migrationName}/migration.sql`,
  "utf8",
);

const routines = [
  {
    signature:
      "public.grainline_listing_shipping_ready(integer,boolean,text,text,text,text,text,integer,double precision,double precision,double precision,integer,double precision,double precision,double precision)",
    delimiter: "$grainline_listing_shipping_ready$",
    securityDefiner: false,
    volatility: "i",
    parallel: "s",
    runtimeExecute: false,
    staffExecute: false,
  },
  {
    signature: "public.grainline_seller_owner_onboarding_complete(text,text)",
    delimiter: "$grainline_seller_owner_onboarding_complete$",
    securityDefiner: true,
    volatility: "v",
    parallel: "u",
    runtimeExecute: true,
    staffExecute: false,
  },
  {
    signature:
      "public.grainline_seller_staff_listing_review_transition(text,text,text,text)",
    delimiter: "$grainline_seller_staff_listing_review_transition$",
    securityDefiner: true,
    volatility: "v",
    parallel: "u",
    runtimeExecute: false,
    staffExecute: true,
  },
];

export function sourceForDelimiter(delimiter) {
  const marker = `AS ${delimiter}`;
  const start = migrationSql.indexOf(marker);
  assert.notEqual(start, -1, `missing ${delimiter} source start`);
  const bodyStart = start + marker.length;
  const end = migrationSql.indexOf(`${delimiter};`, bodyStart);
  assert.notEqual(end, -1, `missing ${delimiter} source end`);
  return migrationSql.slice(bodyStart, end);
}

for (const routine of routines) {
  routine.source = sourceForDelimiter(routine.delimiter);
}

async function readRoutine(client, signature) {
  const result = await client.query(
    `SELECT
       routine.oid::text AS oid,
       pg_catalog.pg_get_userbyid(routine.proowner) AS owner,
       owner_role.rolsuper,
       owner_role.rolbypassrls,
       routine.prosrc,
       routine.prosecdef,
       routine.provolatile,
       routine.proparallel,
       routine.proconfig,
       pg_catalog.has_function_privilege(
         'grainline_app_runtime', routine.oid, 'EXECUTE'
       ) AS runtime_execute,
       pg_catalog.has_function_privilege(
         'grainline_staff_read_runtime', routine.oid, 'EXECUTE'
       ) AS staff_execute,
       EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
           ) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       ) AS public_execute
     FROM pg_catalog.pg_proc AS routine
     JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = routine.proowner
     WHERE routine.oid = pg_catalog.to_regprocedure($1)`,
    [signature],
  );
  return result.rows[0] ?? null;
}

function assertPromotedRoutine(actual, expected) {
  assert.ok(actual, `${expected.signature} is missing`);
  assert.equal(actual.owner, "neondb_owner");
  assert.equal(actual.rolsuper || actual.rolbypassrls, true);
  assert.equal(actual.prosrc, expected.source);
  assert.equal(actual.prosecdef, expected.securityDefiner);
  assert.equal(actual.provolatile, expected.volatility);
  assert.equal(actual.proparallel, expected.parallel);
  assert.equal(actual.proconfig?.length, 1);
  assert.equal(actual.proconfig[0], "search_path=pg_catalog");
  assert.equal(actual.runtime_execute, expected.runtimeExecute);
  assert.equal(actual.staff_execute, expected.staffExecute);
  assert.equal(actual.public_execute, false);
}

export async function inspect(client, mode) {
  assert.ok(mode === "preflight" || mode === "postflight");
  const ledger = await client.query(
    `SELECT checksum, finished_at, rolled_back_at, applied_steps_count
       FROM public._prisma_migrations
      WHERE migration_name = $1`,
    [migrationName],
  );
  assert.ok(ledger.rows.length <= 1, "duplicate C-264 migration ledger rows");

  const actualRoutines = [];
  for (const routine of routines) {
    actualRoutines.push(await readRoutine(client, routine.signature));
  }
  const helperExists = actualRoutines[0] !== null;
  let state;

  if (ledger.rows.length === 1) {
    const row = ledger.rows[0];
    assert.equal(row.checksum, migrationChecksum);
    assert.ok(row.finished_at, "C-264 migration is unfinished");
    assert.equal(row.rolled_back_at, null);
    assert.equal(Number(row.applied_steps_count), 0);
    state = "applied";
  } else if (helperExists) {
    state = "applied-unrecorded";
  } else {
    assert.equal(mode, "preflight", "C-264 migration is absent after apply");
    assert.ok(actualRoutines[1], "onboarding predecessor is missing");
    assert.ok(actualRoutines[2], "staff-review predecessor is missing");
    state = "pending";
  }

  if (state !== "pending") {
    for (let index = 0; index < routines.length; index += 1) {
      assertPromotedRoutine(actualRoutines[index], routines[index]);
    }
  }
  if (mode === "postflight") assert.equal(state, "applied");

  return {
    status: "passed",
    mode,
    migration: migrationName,
    state,
    routineCount: actualRoutines.filter(Boolean).length,
  };
}

async function main() {
  const mode = process.argv[2];
  assert.ok(process.env.DIRECT_URL, "DIRECT_URL is required");
  const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await inspect(client, mode);
    await client.query("COMMIT");
    const output = `${process.env.RUNNER_TEMP}/listing-shipping-readiness-${mode}.json`;
    writeFileSync(output, JSON.stringify(result), { mode: 0o600, flag: "wx" });
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `state=${result.state}\n`);
    }
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {}
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

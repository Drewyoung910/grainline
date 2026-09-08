import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { buildCheckoutReservationRepairOutcomeCorrection, repairOutcomeDefinition } from "./build-checkout-reservation-repair-outcome-correction.mjs";
import { parseInputDraftProofConfig, inputDraftCatalog, assertOnlyInputBodiesChanged } from "./order-input-correction-drafts-postgres-proof.mjs";
import { verifyInputRuntimeIdentity } from "./order-input-correction-runtime-postgres-proof.mjs";
import { proveOrderZeroDirectCompatiblePrefixPostgres } from "./order-zero-direct-compatible-prefix-postgres-proof.mjs";
import { seedRepairOutcomeFixture, repairOutcomeState, callRepairOutcome, proveRepairOutcomeScenarios } from "./checkout-repair-outcome-proof-scenarios.mjs";

const CHILD = "grainline_checkout_repair_runtime_proof";
const RUNTIME = "grainline_app_runtime";
// Non-secret, disposable-CI-only password; refuse any existing password and
// restore NULL on success/failure. Never use production credential files.
const PASSWORD = "checkout-repair-disposable-proof";
const ENV = "CHECKOUT_REPAIR_OUTCOME_PROOF_DATABASE_URL";

export function parseRepairOutcomeProofConfig(env = process.env) {
  return parseInputDraftProofConfig({ ORDER_INPUT_CORRECTION_DRAFTS_PROOF_DATABASE_URL: env[ENV] });
}
export function repairOutcomeProofPayload() {
  const sql = readFileSync("docs/rls-drafts/checkout-reservation-repair-outcome-correction.sql", "utf8");
  assert.equal(sql.trimEnd(), buildCheckoutReservationRepairOutcomeCorrection().trimEnd());
  // The production draft pins neondb_owner. The full CI template is owned by
  // ci. Map ONLY the four owner literals in attestation, never function DDL,
  // body pins, ACL requirements or production SQL on disk.
  assert.equal(sql.split("'neondb_owner'").length, 5);
  const boundary = "\nBEGIN;\nSET LOCAL lock_timeout";
  assert.equal(sql.split(boundary).length, 2);
  assert.match(sql, /\nCOMMIT;\s*$/u);
  return sql.replaceAll("'neondb_owner'", "'ci'")
    .replace(boundary, "\nSET LOCAL lock_timeout").replace(/\nCOMMIT;\s*$/u, "\n");
}

export async function repairProofCatalog(client) {
  const base = await inputDraftCatalog(client);
  const { rows: [extra] } = await client.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_catalog.pg_constraint c) AS constraints,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_catalog.pg_trigger t) AS triggers,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_catalog.pg_index i) AS indexes,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor) FROM pg_catalog.pg_auth_members m) AS memberships,
    (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_catalog.pg_namespace n) AS namespaces`);
  return { ...base, ...extra };
}

export async function verifyRepairProofRole(client, requireEmptyPassword) {
  const { rows } = await client.query(`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,
    rolreplication,rolbypassrls,rolinherit,
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r.oid) AS membership_free
    FROM pg_catalog.pg_roles r WHERE rolname=$1`, [RUNTIME]);
  assert.deepEqual(rows, [{ rolcanlogin: true, rolsuper: false, rolcreatedb: false,
    rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolinherit: false, membership_free: true }]);
  if (requireEmptyPassword) assert.deepEqual((await client.query(`SELECT rolpassword IS NULL AS empty
    FROM pg_catalog.pg_authid WHERE rolname=$1`, [RUNTIME])).rows, [{ empty: true }]);
}

export async function verifyRepairRuntimeCatalog(runtime, corrected = true) {
  const def = repairOutcomeDefinition();
  const digest = createHash("md5").update(def[corrected ? "after" : "before"].split(def.tag)[1]).digest("hex");
  const { rows } = await runtime.query(`SELECT pg_catalog.md5(p.prosrc) AS digest,
    pg_catalog.pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS definer,p.proconfig AS config,
    pg_catalog.has_function_privilege(CURRENT_USER,p.oid,'EXECUTE') AS executable,
    c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,
    pg_catalog.row_security_active(c.oid) AS active,
    (SELECT count(*)::integer FROM pg_catalog.pg_policy WHERE polrelid=c.oid) AS policies,
    pg_catalog.has_table_privilege(CURRENT_USER,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS table_access,
    pg_catalog.has_any_column_privilege(CURRENT_USER,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') AS column_access
    FROM pg_catalog.pg_proc p CROSS JOIN pg_catalog.pg_class c
    WHERE p.oid='public.grainline_checkout_reservation_repair_finalize(text,bigint,text)'::regprocedure
    AND c.oid='public."CheckoutStockReservation"'::regclass`);
  assert.deepEqual(rows, [{ digest, owner: "ci", definer: true, config: ["search_path=pg_catalog"], executable: true,
    enabled: true, forced: true, active: true, policies: 0, table_access: false, column_access: false }]);
}

export async function applyRepairProofDraft(owner, before) {
  const definitions = [repairOutcomeDefinition()];
  // Prove application plus rollback first. A later child-only commit must
  // produce exactly the same body-only delta; never mutate the template.
  await owner.query("BEGIN");
  try {
    await owner.query(repairOutcomeProofPayload());
    assertOnlyInputBodiesChanged(before, await repairProofCatalog(owner), definitions);
  } finally { await owner.query("ROLLBACK"); }
  assert.deepEqual(await repairProofCatalog(owner), before, "repair draft rollback left catalog residue");
  await owner.query("BEGIN");
  try {
    await owner.query(repairOutcomeProofPayload());
    assertOnlyInputBodiesChanged(before, await repairProofCatalog(owner), definitions);
    await owner.query("COMMIT");
  } catch (error) { await owner.query("ROLLBACK"); throw error; }
}

export async function cleanupRepairProof({ controller, owner, runtime, childCreated, passwordTouched, verifyParent }) {
  const failures = [];
  for (const connection of [runtime, owner]) if (connection) {
    try { await connection.end(); } catch (error) { failures.push(error); }
  }
  if (passwordTouched) {
    try {
      await controller.query("ALTER ROLE grainline_app_runtime PASSWORD NULL");
      await verifyRepairProofRole(controller, true);
    } catch (error) { failures.push(error); }
  }
  if (childCreated) {
    try {
      await controller.query(`DROP DATABASE ${CHILD}`);
      assert.equal((await controller.query("SELECT oid FROM pg_catalog.pg_database WHERE datname=$1", [CHILD])).rowCount, 0);
    } catch (error) { failures.push(error); }
  }
  try { await verifyParent(); } catch (error) { failures.push(error); }
  try { await controller.end(); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "disposable repair proof teardown failed");
}

function urlFor(base, db, runtime = false) {
  const url = new URL(base); url.pathname = `/${db}`;
  if (runtime) { url.username = RUNTIME; url.password = PASSWORD; }
  return url.toString();
}
function client(url) {
  return new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000,
    statement_timeout: 30000, query_timeout: 35000, application_name: "checkout-repair-outcome-proof" });
}
export async function runRepairOutcomeProof(env = process.env, phase = () => {}) {
  const { databaseUrl } = parseRepairOutcomeProofConfig(env);
  const controller = client(urlFor(databaseUrl, "postgres"));
  const parent = client(databaseUrl);
  let owner, runtime, beforeParent;
  let childCreated = false, passwordTouched = false;
  const prefix = () => proveOrderZeroDirectCompatiblePrefixPostgres({ ORDER_ZERO_DIRECT_COMPATIBLE_PREFIX_PROOF_DATABASE_URL: databaseUrl });
  await controller.connect();
  try {
    phase("identity-and-template");
    await verifyInputRuntimeIdentity(controller, "postgres", "ci", env.GITHUB_ACTIONS === "true");
    await verifyRepairProofRole(controller, true);
    await prefix();
    await parent.connect();
    try {
      await verifyInputRuntimeIdentity(parent, "grainline_ci", "ci", env.GITHUB_ACTIONS === "true");
      beforeParent = await repairProofCatalog(parent);
    } finally { await parent.end(); }
    assert.equal((await controller.query("SELECT oid FROM pg_catalog.pg_database WHERE datname=$1", [CHILD])).rowCount, 0,
      "refusing an existing repair proof database");
    phase("clone-disposable-template");
    await controller.query(`CREATE DATABASE ${CHILD} WITH TEMPLATE grainline_ci OWNER ci`);
    childCreated = true;
    owner = client(urlFor(databaseUrl, CHILD)); await owner.connect();
    await verifyInputRuntimeIdentity(owner, CHILD, "ci", env.GITHUB_ACTIONS === "true");
    const before = await repairProofCatalog(owner);
    passwordTouched = true;
    await controller.query(`ALTER ROLE grainline_app_runtime PASSWORD '${PASSWORD}'`);
    runtime = client(urlFor(databaseUrl, CHILD, true)); await runtime.connect();
    phase("actual-runtime-login");
    await verifyInputRuntimeIdentity(runtime, CHILD, RUNTIME, env.GITHUB_ACTIONS === "true");
    await verifyRepairProofRole(runtime, false);
    await verifyRepairRuntimeCatalog(runtime, false);
    phase("historical-null-reproduction");
    const old = await seedRepairOutcomeFixture(owner);
    assert.equal((await callRepairOutcome(runtime, old, null)).result, "restored");
    assert.equal((await repairOutcomeState(owner, old)).listing.stockQuantity, 1);
    phase("draft-rollback-and-child-only-commit");
    await applyRepairProofDraft(owner, before);
    await verifyRepairRuntimeCatalog(runtime);
    const results = await proveRepairOutcomeScenarios(owner, runtime, phase);
    assertOnlyInputBodiesChanged(before, await repairProofCatalog(owner), [repairOutcomeDefinition()]);
    return { status: "passed", actualRuntimeLogin: true, historicalNullReproduced: true, correctedFunctionCount: 1,
      ...results, productionChanged: false, providerEffectsProved: false, childRemoved: true, parentUnchanged: true };
  } finally {
    try { await cleanupRepairProof({ controller, owner, runtime, childCreated, passwordTouched,
      verifyParent: async () => {
        await prefix();
        if (beforeParent) {
          const verify = client(databaseUrl); await verify.connect();
          try { assert.deepEqual(await repairProofCatalog(verify), beforeParent, "parent catalog changed"); }
          finally { await verify.end(); }
        }
      } }); } catch (error) {
      phase("teardown-and-parent-verification");
      throw error;
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let phase = "configuration-or-connection";
  try { process.stdout.write(`${JSON.stringify(await runRepairOutcomeProof(process.env, (value) => { phase = value; }))}\n`); }
  catch (error) {
    const code = /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : "ASSERTION_OR_CONNECTION";
    process.stderr.write(`Disposable checkout repair proof failed closed at ${phase} [${code}].\n`);
    process.exitCode = 1;
  }
}

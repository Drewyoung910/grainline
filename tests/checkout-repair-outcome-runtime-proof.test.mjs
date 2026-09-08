import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { repairOutcomeDefinition, buildCheckoutReservationRepairOutcomeCorrection } from "../scripts/build-checkout-reservation-repair-outcome-correction.mjs";
import { parseRepairOutcomeProofConfig, repairOutcomeProofPayload, repairProofCatalog,
  applyRepairProofDraft, verifyRepairProofRole, cleanupRepairProof, verifyRepairRuntimeCatalog,
} from "../scripts/checkout-repair-outcome-runtime-postgres-proof.mjs";
import { assertOnlyInputBodiesChanged } from "../scripts/order-input-correction-drafts-postgres-proof.mjs";
import { seedRepairOutcomeFixture, repairOutcomeState, callRepairOutcome,
  proveRepairOutcomeScenarios } from "../scripts/checkout-repair-outcome-proof-scenarios.mjs";

const ENV = "CHECKOUT_REPAIR_OUTCOME_PROOF_DATABASE_URL";
const source = readFileSync("scripts/checkout-repair-outcome-runtime-postgres-proof.mjs", "utf8");
const role = { rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
  rolreplication: false, rolbypassrls: false, rolinherit: false, membership_free: true };

test("repair proof rejects production, other databases, roles, ports and connection overrides", () => {
  const valid = "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable";
  assert.deepEqual(parseRepairOutcomeProofConfig({ [ENV]: valid }), { databaseUrl: valid });
  for (const url of [undefined, valid.replace("127.0.0.1", "production.example"),
    valid.replace("grainline_ci", "neondb"), valid.replace("//ci:", "//neondb_owner:"),
    valid.replace("//ci:", "//grainline_app_runtime:"), valid.replace(":5432", ":6543"),
    `${valid}&host=production.example`, `${valid}&sslmode=disable`, `${valid}#fragment`,
    valid.replace("postgresql:", "https:"), valid.replace("sslmode=disable", "options=-c%20role=ci")]) {
    assert.throws(() => parseRepairOutcomeProofConfig({ [ENV]: url }));
  }
  assert.doesNotMatch(source, /SET (?:LOCAL )?ROLE|SET SESSION AUTHORIZATION/u);
  assert.match(source, /runtime = client\(urlFor\(databaseUrl, CHILD, true\)\)/u);
});

test("proof maps only exact owner literals and outer transaction, not production bytes or function bodies", () => {
  const draft = readFileSync("docs/rls-drafts/checkout-reservation-repair-outcome-correction.sql", "utf8");
  assert.equal(draft.trimEnd(), buildCheckoutReservationRepairOutcomeCorrection().trimEnd());
  const payload = repairOutcomeProofPayload();
  assert.equal(payload.replaceAll("'ci'", "'neondb_owner'").replace("\nSET LOCAL lock_timeout", "\nBEGIN;\nSET LOCAL lock_timeout")
    .trimEnd() + "\n\nCOMMIT;", draft.trimEnd());
  const def = repairOutcomeDefinition();
  assert.ok(payload.includes(def.after));
  assert.doesNotMatch(payload, /^COMMIT;$/mu);
  assert.doesNotMatch(payload, /(?:GRANT|REVOKE|ALTER TABLE|CREATE POLICY) /u);
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.ok(workflow.indexOf("Prove reservation repair correction through an actual runtime login")
    > workflow.indexOf("Prove complete Order zero-direct prefix in disposable PostgreSQL"));
  assert.match(workflow, /CHECKOUT_REPAIR_OUTCOME_PROOF_DATABASE_URL: \$\{\{ env.DIRECT_URL \}\}/u);
  assert.match(source, /refusing an existing repair proof database/u);
  assert.doesNotMatch(source, /DROP DATABASE.*(?:FORCE|grainline_ci)|pg_terminate_backend/u);
});

test("restricted runtime flags, membership and untouched password are mandatory", async () => {
  const run = (row, empty = true) => verifyRepairProofRole({ query: async (sql) => ({
    rows: sql.includes("pg_authid") ? [{ empty }] : [row],
  }) }, true);
  await run(role);
  for (const key of Object.keys(role)) await assert.rejects(run({ ...role, [key]: !role[key] }));
  await assert.rejects(run(role, false));
});

test("runtime source, owner, function and FORCE/table privileges reject every observed drift", async () => {
  const def = repairOutcomeDefinition();
  const expected = { digest: createHash("md5").update(def.after.split(def.tag)[1]).digest("hex"),
    owner: "ci", definer: true, config: ["search_path=pg_catalog"], executable: true,
    enabled: true, forced: true, active: true, policies: 0, table_access: false, column_access: false };
  const run = (row) => verifyRepairRuntimeCatalog({ query: async () => ({ rows: [row] }) });
  await run(expected);
  for (const [key, value] of Object.entries(expected)) {
    const bad = typeof value === "boolean" ? !value : typeof value === "number" ? 1 : Array.isArray(value) ? [] : "drift";
    await assert.rejects(run({ ...expected, [key]: bad }));
  }
});

test("teardown attempts independent owned cleanup and rejects every failure or retained resource", async () => {
  for (const failure of [null, "runtime-end", "owner-end", "password", "password-verify", "drop", "drop-verify", "parent", "controller-end"]) {
    const calls = [];
    const step = (name) => { calls.push(name); if (failure === name) throw Error("injected"); };
    const controller = {
      query: async (sql) => {
        if (sql.startsWith("ALTER ROLE")) { step("password"); return { rows: [] }; }
        if (sql.includes("pg_roles")) return { rows: [role] };
        if (sql.includes("pg_authid")) return { rows: [{ empty: failure !== "password-verify" }] };
        if (sql.startsWith("DROP DATABASE")) { step("drop"); return { rows: [] }; }
        return { rowCount: failure === "drop-verify" ? 1 : 0 };
      }, end: async () => step("controller-end"),
    };
    const run = () => cleanupRepairProof({ controller,
      runtime: { end: async () => step("runtime-end") }, owner: { end: async () => step("owner-end") },
      childCreated: true, passwordTouched: true, verifyParent: async () => step("parent") });
    if (failure) await assert.rejects(run(), /teardown failed/); else await run();
    assert.deepEqual(calls, ["runtime-end", "owner-end", "password", "drop", "parent", "controller-end"]);
  }
});

test("cleanup preserves a preexisting child and an untouched runtime password", async () => {
  const calls = [];
  await cleanupRepairProof({ controller: { query: async () => assert.fail("unexpected mutation"), end: async () => calls.push("end") },
    childCreated: false, passwordTouched: false, verifyParent: async () => calls.push("parent") });
  assert.deepEqual(calls, ["parent", "end"]);
});

test("real repair functions reproduce NULL restoration then preserve all legitimate outcomes with raw row invariants", async () => {
  const localUrl = "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable";
  const schema = execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff",
    "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"], {
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DATABASE_URL: localUrl, DIRECT_URL: localUrl },
  });
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE ci SUPERUSER; CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS; SET ROLE ci");
    await db.exec(schema);
    await db.exec("CREATE TABLE public._prisma_migrations (id text PRIMARY KEY)");
    const history = readFileSync("prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql", "utf8");
    const start = history.indexOf("CREATE FUNCTION public.grainline_checkout_reservation_items_valid(");
    const end = history.indexOf('CREATE INDEX "CheckoutStockReservation_repair_claim_idx"', start);
    assert.ok(start > 0 && end > start);
    await db.exec(history.slice(start, end)); // real normalize trigger, checks and partial unique index
    const helper = "grainline_checkout_reservation_restore_items";
    const helperStart = history.indexOf(`CREATE FUNCTION public.${helper}(`);
    await db.exec(history.slice(helperStart, history.indexOf(`$${helper}$;`, helperStart) + helper.length + 3));
    await db.exec(repairOutcomeDefinition().before);
    await db.exec(`REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_repair_finalize(text,bigint,text),
      public.grainline_checkout_reservation_restore_items(jsonb) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_repair_finalize(text,bigint,text) TO grainline_app_runtime;
      ALTER TABLE public."CheckoutStockReservation" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public."CheckoutStockReservation" FORCE ROW LEVEL SECURITY;`);
    // PGlite cannot authenticate a second session; this adapter verifies only
    // the shared behavior matrix. Native CI independently verifies real login.
    const runtime = { query: async (sql, params) => {
      await db.exec("SET ROLE grainline_app_runtime");
      try { return await db.query(sql, params); } finally { await db.exec("RESET ROLE; SET ROLE ci"); }
    } };
    const old = await seedRepairOutcomeFixture(db);
    assert.equal((await callRepairOutcome(runtime, old, null)).result, "restored");
    assert.equal((await repairOutcomeState(db, old)).listing.stockQuantity, 1);
    const before = await repairProofCatalog(db);
    // node-postgres uses the simple protocol for an unparameterized SQL batch;
    // PGlite exposes that protocol separately as exec().
    const owner = { query: (sql, params) => sql === repairOutcomeProofPayload()
      ? db.exec(sql) : db.query(sql, params) };
    for (const failAt of [1, 2]) {
      let applied = 0;
      const failingOwner = { query: async (sql, params) => {
        const result = await owner.query(sql, params);
        if (sql === repairOutcomeProofPayload() && ++applied === failAt) await db.query("SELECT 1/0");
        return result;
      } };
      await assert.rejects(applyRepairProofDraft(failingOwner, before), { code: "22012" });
      assert.deepEqual(await repairProofCatalog(db), before, "failed draft application retained changes");
    }
    await applyRepairProofDraft(owner, before);
    assert.deepEqual(await proveRepairOutcomeScenarios(db, runtime), {
      invalidInputs: 20, legitimateOutcomes: 12, sessionMismatchControls: 2, paidOrderPreserved: true,
      unclaimedAndAbsentPreserved: true, directDenials: 6,
    });
    const after = await repairProofCatalog(db);
    assertOnlyInputBodiesChanged(before, after, [repairOutcomeDefinition()]);
    for (const key of ["constraints", "triggers", "indexes", "memberships", "namespaces", "migrations"]) {
      const drifted = structuredClone(after); drifted[key] = [{ unexpected: true }];
      assert.throws(() => assertOnlyInputBodiesChanged(before, drifted, [repairOutcomeDefinition()]));
    }
    // A second application or a failed attestation must not silently accept a
    // different catalog. Roll back the aborted transaction and retain the fix.
    await db.exec("BEGIN");
    await assert.rejects(db.exec(repairOutcomeProofPayload()), /before function authority drifted/);
    await db.exec("ROLLBACK");
    assert.deepEqual(await repairProofCatalog(db), after);
  } finally { await db.close(); }
});

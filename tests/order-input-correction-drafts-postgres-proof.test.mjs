import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { proofServerHostAccepted } from "../scripts/disposable-postgres-proof-host.mjs";
import {
  parseInputDraftProofConfig, inputDraftBundle, assertOnlyInputBodiesChanged,
  proveInputDraftTransaction,
} from "../scripts/order-input-correction-drafts-postgres-proof.mjs";

test("input draft proof refuses production identities and connection overrides", () => {
  const ENV = "ORDER_INPUT_CORRECTION_DRAFTS_PROOF_DATABASE_URL";
  const valid = "postgresql://ci:ci@localhost:5432/grainline_ci?sslmode=disable";
  assert.deepEqual(parseInputDraftProofConfig({ [ENV]: valid }), { databaseUrl: valid });
  for (const url of [undefined, valid.replace("localhost", "production.example"),
    valid.replace("/grainline_ci", "/neondb"), valid.replace("//ci:", "//neondb_owner:"),
    valid.replace("//ci:", "//grainline_app_runtime:"), valid.replace(":5432", ":6543"),
    `${valid}&host=production.example`, `${valid}#fragment`, valid.replace("postgresql:", "https:")]) {
    assert.throws(() => parseInputDraftProofConfig({ [ENV]: url }));
  }
});

test("exact draft payloads omit outer commit and remain behind full-prefix CI", () => {
  const bundle = inputDraftBundle();
  assert.equal(bundle.length, 3);
  assert.equal(bundle.flatMap((d) => d.definitions).length, 5);
  for (const { payload } of bundle) {
    assert.doesNotMatch(payload, /^COMMIT;$/mu);
    assert.match(payload, /SET LOCAL lock_timeout = '5s'/u);
    assert.match(payload, /before authority drifted/u);
  }
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.ok(workflow.indexOf("Prove input correction drafts without retaining catalog changes")
    > workflow.indexOf("Prove complete Order zero-direct prefix in disposable PostgreSQL"));
  assert.match(workflow, /ORDER_INPUT_CORRECTION_DRAFTS_PROOF_DATABASE_URL: \$\{\{ env.DIRECT_URL \}\}/u);
});

test("PostgreSQL server identity uses the address, not inet text with a mask", async () => {
  const db = new PGlite();
  try {
    const { rows: [identity] } = await db.query(`SELECT
      inet '172.18.0.2'::text AS masked,
      pg_catalog.host(inet '172.18.0.2') AS address`);
    assert.equal(identity.masked, "172.18.0.2/32");
    assert.equal(identity.address, "172.18.0.2");
    assert.equal(proofServerHostAccepted(identity.masked, true), false);
    assert.equal(proofServerHostAccepted(identity.address, true), true);
    assert.equal(proofServerHostAccepted(identity.address, false), false);
    const source = readFileSync("scripts/order-input-correction-drafts-postgres-proof.mjs", "utf8");
    assert.match(source, /pg_catalog\.host\(pg_catalog\.inet_server_addr\(\)\)/u);
    assert.doesNotMatch(source, /inet_server_addr\(\)::text/u);
  } finally { await db.close(); }
});

test("catalog comparator rejects metadata, grant, overload and unrelated source changes", () => {
  const definitions = [{ name: "target", tag: "$x$", before: "$x$old$x$", after: "$x$new$x$" }];
  const before = { functions: [{ proname: "target", prosrc: "old", proacl: ["owner=X/owner"] },
    { proname: "other", prosrc: "untouched" }], policies: [] };
  const after = structuredClone(before);
  after.functions[0].prosrc = "new";
  assertOnlyInputBodiesChanged(before, after, definitions);
  for (const mutate of [
    (s) => { s.functions[0].proacl = []; },
    (s) => { s.functions[1].prosrc = "drift"; },
    (s) => { s.policies.push({ permissive: true }); },
    (s) => { s.functions.push({ proname: "target", prosrc: "new" }); },
  ]) {
    const drifted = structuredClone(after); mutate(drifted);
    assert.throws(() => assertOnlyInputBodiesChanged(before, drifted, definitions));
  }
});

test("PostgreSQL transaction harness proves rollback on success and injected failure", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public._prisma_migrations(id text PRIMARY KEY);
      CREATE FUNCTION public.target() RETURNS integer LANGUAGE sql AS $x$SELECT 1$x$;`);
    const bundle = [{ name: "synthetic", payload: "CREATE OR REPLACE FUNCTION public.target() RETURNS integer LANGUAGE sql AS $x$SELECT 2$x$;",
      definitions: [{ name: "target", tag: "$x$", before: "$x$SELECT 1$x$", after: "$x$SELECT 2$x$" }] }];
    assert.equal((await proveInputDraftTransaction(db, bundle)).rolledBack, true);
    assert.deepEqual((await db.query("SELECT public.target() AS n")).rows, [{ n: 1 }]);
    await assert.rejects(proveInputDraftTransaction(db, [...bundle,
      { payload: "SELECT 1 / 0", definitions: [] }]));
    assert.deepEqual((await db.query("SELECT public.target() AS n")).rows, [{ n: 1 }]);
  } finally { await db.close(); }
});

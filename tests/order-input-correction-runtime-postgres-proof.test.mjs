import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  parseInputRuntimeProofConfig, verifyInputRuntimeIdentity, cleanupInputRuntimeProof, proveInputRuntimeCalls,
  proveInputNotificationReadBoundary,
} from "../scripts/order-input-correction-runtime-postgres-proof.mjs";
import { inputDraftBundle } from "../scripts/order-input-correction-drafts-postgres-proof.mjs";

const ENV = "ORDER_INPUT_CORRECTION_RUNTIME_PROOF_DATABASE_URL";
const source = readFileSync("scripts/order-input-correction-runtime-postgres-proof.mjs", "utf8");

test("runtime proof accepts only the disposable template URL", () => {
  const url = "postgresql://ci:ci@localhost:5432/grainline_ci?sslmode=disable";
  assert.deepEqual(parseInputRuntimeProofConfig({ [ENV]: url }), { databaseUrl: url });
  for (const value of [undefined, url.replace("localhost", "production.example"),
    url.replace("/grainline_ci", "/neondb"), url.replace("//ci:", "//neondb_owner:"),
    url.replace("//ci:", "//grainline_app_runtime:"), `${url}&host=production.example`,
    url.replace(":5432", ":6432"), url.replace("postgresql:", "https:"),
    `${url}#database-override`, `${url}&sslmode=disable`,
    url.replace("sslmode=disable", "options=-c%20role=ci")]) {
    assert.throws(() => parseInputRuntimeProofConfig({ [ENV]: value }));
  }
});

test("runtime identity rejects simulated login, wrong database/version and unapproved host", async () => {
  const identity = { db: "grainline_order_input_runtime_proof", actor: "grainline_app_runtime",
    login: "grainline_app_runtime", version: 160004, host: "172.18.0.2" };
  const run = (row, ci = true) => verifyInputRuntimeIdentity({ query: async () => ({ rows: [row] }) },
    identity.db, identity.actor, ci);
  await run(identity);
  for (const change of [{ actor: "ci" }, { login: "ci" }, { db: "grainline_ci" },
    { version: 150010 }, { version: 170000 }, { host: "172.18.0.2/32" }, { host: "8.8.8.8" }]) {
    await assert.rejects(run({ ...identity, ...change }));
  }
  await assert.rejects(run(identity, false));
  assert.doesNotMatch(source, /SET (?:LOCAL )?ROLE|SET SESSION AUTHORIZATION/u);
  assert.match(source, /runtime = makeClient\(connectUrl\(databaseUrl, CHILD, true\)\)/u);
});

test("proof preserves the parent and wires only ordinary disposable CI", () => {
  assert.match(source, /CREATE DATABASE \$\{CHILD\} WITH TEMPLATE grainline_ci OWNER ci/u);
  assert.match(source, /refusing an existing proof database/u);
  assert.match(source, /absence-control identities already exist/u);
  assert.match(source, /assertOnlyInputBodiesChanged/u);
  assert.match(source, /await correctedSources\(runtime,/u);
  assert.match(source, /BEGIN ISOLATION LEVEL READ COMMITTED/u);
  assert.match(source, /finally \{ await runtime\.query\("ROLLBACK"\); \}/u);
  assert.match(source, /providerEffectsProved: false/u);
  assert.doesNotMatch(source, /DROP DATABASE.*(?:FORCE|grainline_ci)|pg_terminate_backend/u);
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const step = workflow.indexOf("Prove corrected input boundaries through an actual runtime login");
  assert.ok(step > workflow.indexOf("Prove input correction drafts without retaining catalog changes"));
  assert.match(workflow, /ORDER_INPUT_CORRECTION_RUNTIME_PROOF_DATABASE_URL: \$\{\{ env.DIRECT_URL \}\}/u);
});

test("teardown attempts every owned resource and fails if any cleanup fails", async () => {
  for (const fail of [null, "runtime-end", "owner-end", "password", "password-verification",
    "drop", "drop-verification", "verify-prefix", "controller-end"]) {
    const calls = [];
    const controller = {
      query: async (sql) => {
        if (sql.startsWith("ALTER ROLE")) {
          calls.push("password"); if (fail === "password") throw Error("injected");
          return { rows: [] };
        }
        if (sql.includes("pg_catalog.pg_roles")) return { rows: [{ rolcanlogin: true,
          rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false,
          rolbypassrls: false, rolinherit: false }] };
        if (sql.includes("pg_catalog.pg_authid")) return { rows: [{ empty: fail !== "password-verification" }] };
        if (sql.startsWith("DROP DATABASE")) {
          calls.push("drop"); if (fail === "drop") throw Error("injected");
          return { rows: [] };
        }
        return { rowCount: fail === "drop-verification" ? 1 : 0 };
      },
      end: async () => { calls.push("controller-end"); if (fail === "controller-end") throw Error("injected"); },
    };
    const action = () => cleanupInputRuntimeProof({ controller,
      runtime: { end: async () => { calls.push("runtime-end"); if (fail === "runtime-end") throw Error("injected"); } },
      owner: { end: async () => { calls.push("owner-end"); if (fail === "owner-end") throw Error("injected"); } },
      childCreated: true, passwordTouched: true,
      verifyPrefix: async () => { calls.push("verify-prefix"); if (fail === "verify-prefix") throw Error("injected"); },
    });
    if (fail) await assert.rejects(action(), /teardown failed/);
    else await action();
    assert.deepEqual(calls, ["runtime-end", "owner-end", "password", "drop", "verify-prefix", "controller-end"]);
  }
});

test("teardown does not drop a preexisting child or reset an untouched password", async () => {
  const calls = [];
  await cleanupInputRuntimeProof({
    controller: { query: async () => { throw Error("unexpected mutation"); }, end: async () => calls.push("end") },
    childCreated: false, passwordTouched: false, verifyPrefix: async () => calls.push("verify"),
  });
  assert.deepEqual(calls, ["verify", "end"]);
});

test("Notification read control fails closed on posture, context or visible-row drift", async () => {
  const expected = { enabled: true, forced: true, active: true, can_select: true,
    can_insert: false, can_delete: false, can_update_table: false, can_update_read: true,
    can_update_title: false, recipient: "" };
  const run = (row, visible = []) => proveInputNotificationReadBoundary({ query: async (sql) => ({
    rows: sql.includes("pg_catalog.pg_class") ? [row] : visible,
  }) });
  await run(expected);
  for (const key of Object.keys(expected)) {
    await assert.rejects(run({ ...expected, [key]: key === "recipient" ? "unexpected-user" : !expected[key] }));
  }
  await assert.rejects(run(expected, [{ id: "unexpected-visible-row" }]));
});

test("runtime call matrix fails on historical guards and passes corrected engine functions", async () => {
  // Offline schema-to-SQL conversion only: never use --from-config-datasource
  // or a migration deploy. This fixture is not full migration/trigger proof.
  const fixtureUrl = "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable";
  const schema = execFileSync(process.execPath, ["node_modules/prisma/build/index.js",
    "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"],
  { encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, DATABASE_URL: fixtureUrl, DIRECT_URL: fixtureUrl },
    stdio: ["ignore", "pipe", "pipe"] });
  const db = new PGlite();
  try {
    await db.exec(schema);
    await db.exec("CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS");
    // Reuse the real recipient policies/grants, not an artificial no-SELECT
    // fixture. Reads are RLS-filtered; only non-read-column writes are denied.
    const activation = readFileSync("prisma/migrations/20260722052000_enable_notification_rls/migration.sql", "utf8");
    const policyStart = activation.indexOf('ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;');
    const policyEnd = activation.indexOf("DO $grainline_notification_activation_postflight$", policyStart);
    assert.ok(policyStart >= 0 && policyEnd > policyStart);
    await db.exec(activation.slice(policyStart, policyEnd));
    await db.exec('ALTER TABLE public."Notification" FORCE ROW LEVEL SECURITY;');
    await db.exec(`INSERT INTO public."User" (id, "clerkId", email, "updatedAt")
      VALUES ('notification-foreign-user', 'notification-foreign-clerk', 'foreign@example.invalid', now());
      INSERT INTO public."Notification" (id, "userId", type, title, body)
      VALUES ('notification-foreign-row', 'notification-foreign-user', 'ORDER_DELIVERED', 'Private', 'Private');`);
    const bundle = inputDraftBundle();
    for (const { name, args, before, runtimeExecute } of bundle.flatMap((d) => d.definitions)) {
      await db.exec(before);
      await db.exec(`REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC, grainline_app_runtime`);
      if (runtimeExecute !== false) await db.exec(`GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO grainline_app_runtime`);
    }
    const history = readFileSync("prisma/migrations/20260722051500_prepare_notification_rls/migration.sql", "utf8");
    const wrapper = "grainline_notification_create_order_event";
    const end = `$${wrapper}$;`;
    const start = history.indexOf(`CREATE OR REPLACE FUNCTION public.${wrapper}(`);
    assert.ok(start >= 0);
    await db.exec(history.slice(start, history.indexOf(end, start) + end.length));
    await db.exec(`REVOKE ALL ON FUNCTION public.${wrapper}(text,text,public."NotificationType",text,text,text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.${wrapper}(text,text,public."NotificationType",text,text,text) TO grainline_app_runtime;
      SET ROLE grainline_app_runtime`);
    // Reproduce the failed CI assumption with real recipient policy/grants:
    // SELECT is allowed but the foreign row is invisible, rather than 42501.
    await assert.rejects(async () => {
      await assert.rejects(db.query('SELECT * FROM public."Notification" LIMIT 1'), { code: "42501" });
    }, /Missing expected rejection/u);
    await proveInputNotificationReadBoundary(db);
    await assert.rejects(proveInputRuntimeCalls(db), /Missing expected rejection/);
    await db.exec("RESET ROLE");
    for (const { payload } of bundle) await db.exec(payload);
    await db.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(await proveInputRuntimeCalls(db), {
      denials: 25, absenceControls: 5, notificationReadPostureChecked: true,
    });
    await db.exec(`RESET ROLE;
      ALTER POLICY grainline_notification_recipient_select ON public."Notification" USING (true);
      SET ROLE grainline_app_runtime;`);
    await assert.rejects(proveInputNotificationReadBoundary(db), /observed Notification rows/u);
  } finally { await db.close(); }
});

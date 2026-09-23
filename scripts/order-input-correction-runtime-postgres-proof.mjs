import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { proofServerHostAccepted } from "./disposable-postgres-proof-host.mjs";
import {
  parseInputDraftProofConfig, inputDraftBundle, inputDraftCatalog,
  assertOnlyInputBodiesChanged,
} from "./order-input-correction-drafts-postgres-proof.mjs";
import { proveOrderZeroDirectCompatiblePrefixPostgres } from "./order-zero-direct-compatible-prefix-postgres-proof.mjs";

const CHILD = "grainline_order_input_runtime_proof";
const RUNTIME = "grainline_app_runtime";
// A deliberately non-secret password, valid only inside the disposable CI
// service. The predecessor must have NULL password and teardown restores it.
const PASSWORD = "order-input-draft-runtime-proof";
const ENV = "ORDER_INPUT_CORRECTION_RUNTIME_PROOF_DATABASE_URL";
const MISSING = "order-input-runtime-proof-missing";
const RELATED = "order-input-runtime-proof-related";
const LABEL_CLAIM = "order-label-claim:11111111-1111-4111-8111-111111111111";
const REFUND_CLAIM = "order_refund_claim_11111111-1111-4111-8111-111111111111";

export function parseInputRuntimeProofConfig(env = process.env) {
  return parseInputDraftProofConfig({ ORDER_INPUT_CORRECTION_DRAFTS_PROOF_DATABASE_URL: env[ENV] });
}

function connectUrl(base, database, runtime = false) {
  const url = new URL(base);
  url.pathname = `/${database}`;
  if (runtime) { url.username = RUNTIME; url.password = PASSWORD; }
  return url.toString();
}

function makeClient(url) {
  return new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000,
    statement_timeout: 30000, query_timeout: 35000, application_name: "order-input-runtime-proof" });
}

export async function verifyInputRuntimeIdentity(client, database, role, githubActions) {
  const { rows: [identity] } = await client.query(`SELECT current_database() AS db,
    CURRENT_USER AS actor, SESSION_USER AS login,
    current_setting('server_version_num')::integer AS version,
    pg_catalog.host(pg_catalog.inet_server_addr()) AS host`);
  assert.equal(identity.db, database);
  assert.equal(identity.actor, role);
  assert.equal(identity.login, role);
  assert.ok(identity.version >= 160000 && identity.version < 170000, "requires PostgreSQL 16");
  assert.ok(proofServerHostAccepted(identity.host, githubActions), "requires disposable loopback/CI server");
}

async function runtimeRole(client, requireEmptyPassword) {
  const { rows } = await client.query(`SELECT rolcanlogin, rolsuper, rolcreatedb,
    rolcreaterole, rolreplication, rolbypassrls, rolinherit
    FROM pg_catalog.pg_roles WHERE rolname = $1`, [RUNTIME]);
  assert.deepEqual(rows, [{ rolcanlogin: true, rolsuper: false, rolcreatedb: false,
    rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolinherit: false }]);
  if (requireEmptyPassword) {
    assert.deepEqual((await client.query(`SELECT rolpassword IS NULL AS empty
      FROM pg_catalog.pg_authid WHERE rolname = $1`, [RUNTIME])).rows, [{ empty: true }]);
  }
}

async function correctedSources(client, definitions) {
  for (const { name, args, tag, after } of definitions) {
    const { rows } = await client.query(`SELECT pg_catalog.md5(prosrc) AS digest
      FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure($1)`, [`public.${name}(${args})`]);
    assert.deepEqual(rows, [{ digest: createHash("md5").update(after.split(tag)[1]).digest("hex") }]);
  }
}

export async function proveInputNotificationReadBoundary(runtime) {
  const { rows } = await runtime.query(`SELECT
    c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
    pg_catalog.row_security_active(c.oid) AS active,
    pg_catalog.has_table_privilege(CURRENT_USER, c.oid, 'SELECT') AS can_select,
    pg_catalog.has_table_privilege(CURRENT_USER, c.oid, 'INSERT') AS can_insert,
    pg_catalog.has_table_privilege(CURRENT_USER, c.oid, 'DELETE') AS can_delete,
    pg_catalog.has_table_privilege(CURRENT_USER, c.oid, 'UPDATE') AS can_update_table,
    pg_catalog.has_column_privilege(CURRENT_USER, c.oid, 'read', 'UPDATE') AS can_update_read,
    pg_catalog.has_column_privilege(CURRENT_USER, c.oid, 'title', 'UPDATE') AS can_update_title,
    COALESCE(pg_catalog.current_setting('app.user_id', true), '') AS recipient
    FROM pg_catalog.pg_class c WHERE c.oid = 'public."Notification"'::regclass`);
  assert.deepEqual(rows, [{ enabled: true, forced: true, active: true, can_select: true,
    can_insert: false, can_delete: false, can_update_table: false, can_update_read: true,
    can_update_title: false, recipient: "" }], "Notification read posture or recipient context drifted");
  assert.deepEqual((await runtime.query('SELECT * FROM public."Notification" LIMIT 1')).rows, [],
    "runtime without recipient context observed Notification rows");
}

export async function proveInputRuntimeCalls(runtime, onCase = () => {}) {
  let denials = 0;
  let controls = 0;
  let sequence = 0;
  const denied = async (sql, values, code, message) => {
    const point = `input_denial_${++sequence}`;
    onCase(point);
    await runtime.query(`SAVEPOINT ${point}`);
    try {
      await assert.rejects(runtime.query(sql, values), (error) => {
        assert.equal(error.code, code);
        assert.ok(error.message.includes(message), "wrong rejection boundary");
        return true;
      });
      denials += 1;
    } finally {
      await runtime.query(`ROLLBACK TO SAVEPOINT ${point}`);
      await runtime.query(`RELEASE SAVEPOINT ${point}`);
    }
  };
  const label = "SELECT public.grainline_order_seller_label_provider_record($1,$2,$3,1,$4,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL) AS result";
  const clawback = "SELECT public.grainline_order_label_clawback_finalize($1,$2,1,1,$3,NULL,NULL) AS result";
  const ambiguous = "SELECT public.grainline_order_refund_claim_mark_ambiguous($1,1,$2) AS result";
  const reconcile = "SELECT public.grainline_order_refund_reconcile($1,$2,1,$3,'Reviewed disposable provider evidence',extract(epoch FROM clock_timestamp())::bigint,$4,$5) AS result";
  const notification = `SELECT public.grainline_notification_create_order_event(
    '11111111-1111-4111-8111-111111111111',$1,$2,'order_fulfillment',$1,$3) AS result`;
  await runtime.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  try {
    assert.deepEqual((await runtime.query("SELECT current_setting('transaction_isolation') AS isolation")).rows,
      [{ isolation: "read committed" }]);
    for (const invalid of [null, "", "unknown", "SUCCESS "]) {
      await denied(label, [MISSING, MISSING, LABEL_CLAIM, invalid], "22023", "Order label provider result input is invalid");
      await denied(clawback, [MISSING, LABEL_CLAIM, invalid], "22023", "Order label clawback result input is invalid");
    }
    for (const invalid of [null, "", "unknown", "SELLER_PROVIDER_AMBIGUOUS "]) {
      await denied(ambiguous, [REFUND_CLAIM, invalid], "23514", "Order refund ambiguous transition input is invalid");
    }
    for (const invalid of [null, "", "unknown", "ABSENT "]) {
      await denied(reconcile, [MISSING, REFUND_CLAIM, invalid, "ABSENT", "a".repeat(64)], "23514", "Order refund reconciliation transition input is invalid");
      await denied(reconcile, [MISSING, REFUND_CLAIM, "RETRY_EXISTING_SCOPE", invalid, "a".repeat(64)], "23514", "Order refund reconciliation transition input is invalid");
    }
    await denied(notification, [MISSING, null, RELATED], "22023", "notification source does not match notification type");
    await denied(`SELECT public.grainline_notification_create_core(
      '11111111-1111-4111-8111-111111111111',$1,'ORDER_DELIVERED','order_fulfillment',$1,NULL)`,
    [MISSING], "42501", "permission denied for function");
    await denied('UPDATE public."Notification" SET title = title WHERE false', [], "42501", "permission denied");
    onCase("notification-no-context-read");
    await proveInputNotificationReadBoundary(runtime);

    // Valid domains still reach the historical missing-source/stale-claim
    // behavior. These are absence controls, not successful provider effects.
    onCase("valid-label-absence");
    assert.deepEqual((await runtime.query(label, [MISSING, MISSING, LABEL_CLAIM, "REJECTED"])).rows, [{ result: null }]); controls++;
    onCase("valid-clawback-absence");
    assert.deepEqual((await runtime.query(clawback, [MISSING, LABEL_CLAIM, "FAILED"])).rows,
      [{ result: { outcome: "conflict", reason: "stale_claim" } }]); controls++;
    await denied(ambiguous, [REFUND_CLAIM, "SELLER_PROVIDER_AMBIGUOUS"], "40001", "not active for ambiguous transition"); controls++;
    await denied(reconcile, [MISSING, REFUND_CLAIM, "RETRY_EXISTING_SCOPE", "ABSENT", "a".repeat(64)], "42501", "requires a current ADMIN"); controls++;
    onCase("valid-notification-absence");
    assert.deepEqual((await runtime.query(notification, [MISSING, "ORDER_DELIVERED", RELATED])).rows, [{ result: null }]); controls++;
  } finally { await runtime.query("ROLLBACK"); }
  return { denials, absenceControls: controls, notificationReadPostureChecked: true };
}

export async function cleanupInputRuntimeProof({ controller, runtime, owner, childCreated, passwordTouched, verifyPrefix }) {
  const failures = [];
  for (const connection of [runtime, owner]) if (connection) {
    try { await connection.end(); } catch (error) { failures.push(error); }
  }
  if (passwordTouched) {
    try {
      await controller.query("ALTER ROLE grainline_app_runtime PASSWORD NULL");
      await runtimeRole(controller, true);
    } catch (error) { failures.push(error); }
  }
  if (childCreated) {
    try {
      await controller.query(`DROP DATABASE ${CHILD}`);
      assert.equal((await controller.query("SELECT oid FROM pg_catalog.pg_database WHERE datname = $1", [CHILD])).rowCount, 0);
    } catch (error) { failures.push(error); }
  }
  try { await verifyPrefix(); } catch (error) { failures.push(error); }
  try { await controller.end(); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "disposable runtime proof teardown failed");
}

export async function runInputRuntimeProof(env = process.env, phase = () => {}) {
  const { databaseUrl } = parseInputRuntimeProofConfig(env);
  const controller = makeClient(connectUrl(databaseUrl, "postgres"));
  let owner;
  let runtime;
  let childCreated = false;
  let passwordTouched = false;
  const prefixEnv = { ORDER_ZERO_DIRECT_COMPATIBLE_PREFIX_PROOF_DATABASE_URL: databaseUrl };
  await controller.connect();
  try {
    phase("controller-identity");
    await verifyInputRuntimeIdentity(controller, "postgres", "ci", env.GITHUB_ACTIONS === "true");
    await runtimeRole(controller, true);
    await proveOrderZeroDirectCompatiblePrefixPostgres(prefixEnv);
    assert.equal((await controller.query("SELECT oid FROM pg_catalog.pg_database WHERE datname = $1", [CHILD])).rowCount, 0,
      "refusing an existing proof database");
    phase("clone-exact-disposable-template");
    await controller.query(`CREATE DATABASE ${CHILD} WITH TEMPLATE grainline_ci OWNER ci`);
    childCreated = true;
    owner = makeClient(connectUrl(databaseUrl, CHILD)); await owner.connect();
    await verifyInputRuntimeIdentity(owner, CHILD, "ci", env.GITHUB_ACTIONS === "true");
    assert.equal((await owner.query(`SELECT id FROM public."User" WHERE id IN ($1, $4)
      UNION ALL SELECT id FROM public."Order" WHERE id = $1 OR "labelClaimId" = $2 OR "refundClaimId" = $3`,
    [MISSING, LABEL_CLAIM, REFUND_CLAIM, RELATED])).rowCount, 0, "absence-control identities already exist");
    const before = await inputDraftCatalog(owner);
    const bundle = inputDraftBundle();
    phase("commit-drafts-in-child-only");
    await owner.query("BEGIN");
    try {
      for (const { payload } of bundle) await owner.query(payload);
      assertOnlyInputBodiesChanged(before, await inputDraftCatalog(owner), bundle.flatMap((d) => d.definitions));
      await owner.query("COMMIT");
    } catch (error) { await owner.query("ROLLBACK"); throw error; }
    phase("install-disposable-runtime-password");
    passwordTouched = true;
    await controller.query(`ALTER ROLE grainline_app_runtime PASSWORD '${PASSWORD}'`);
    runtime = makeClient(connectUrl(databaseUrl, CHILD, true)); await runtime.connect();
    phase("actual-runtime-login");
    await verifyInputRuntimeIdentity(runtime, CHILD, RUNTIME, env.GITHUB_ACTIONS === "true");
    await runtimeRole(runtime, false);
    await correctedSources(runtime, bundle.flatMap((d) => d.definitions));
    phase("runtime-input-boundaries");
    const result = await proveInputRuntimeCalls(runtime, (name) => phase(`runtime-input-${name}`));
    assertOnlyInputBodiesChanged(before, await inputDraftCatalog(owner), bundle.flatMap((d) => d.definitions));
    return { status: "passed", actualRuntimeLogin: true, correctedFunctionCount: 5, ...result,
      providerEffectsProved: false, productionChanged: false };
  } finally {
    // Continue every independent teardown action even if one fails; never
    // report success with a retained password/database or swallowed error.
    await cleanupInputRuntimeProof({ controller, runtime, owner, childCreated, passwordTouched,
      verifyPrefix: () => proveOrderZeroDirectCompatiblePrefixPostgres(prefixEnv) });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let phase = "configuration-or-connection";
  try { process.stdout.write(`${JSON.stringify(await runInputRuntimeProof(process.env, (value) => { phase = value; }))}\n`); }
  catch (error) {
    const code = /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : "ASSERTION_OR_CONNECTION";
    process.stderr.write(`Disposable Order input runtime proof failed closed at ${phase} [${code}].\n`);
    process.exitCode = 1;
  }
}

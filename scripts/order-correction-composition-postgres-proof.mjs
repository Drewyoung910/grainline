import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { correctionCompositionBundle } from "./order-correction-composition-manifest.mjs";
import { parseInputDraftProofConfig, assertOnlyInputBodiesChanged } from "./order-input-correction-drafts-postgres-proof.mjs";
import { repairProofCatalog, verifyRepairProofRole } from "./checkout-repair-outcome-runtime-postgres-proof.mjs";
import { verifyInputRuntimeIdentity, proveInputRuntimeCalls } from "./order-input-correction-runtime-postgres-proof.mjs";
import { caseLifecycleScenarios, runCaseLifecycleScenario, caseLifecycleFixture, caseLifecycleRuntime } from "./case-lifecycle-correction-scenarios.mjs";
import { proveRepairOutcomeScenarios } from "./checkout-repair-outcome-proof-scenarios.mjs";
import { proveOrderZeroDirectCompatiblePrefixPostgres } from "./order-zero-direct-compatible-prefix-postgres-proof.mjs";

export function parseCompositionProofConfig(env = process.env) {
  return parseInputDraftProofConfig({ ORDER_INPUT_CORRECTION_DRAFTS_PROOF_DATABASE_URL:
    env.ORDER_CORRECTION_COMPOSITION_PROOF_DATABASE_URL });
}

// Reuse existing component scenarios without letting their fixture transaction
// controls commit our outer proof. This adapter is CI-only, not a DB abstraction.
// Each instance owns one fixed savepoint; a nested or unbalanced scope fails.
export function compositionTransactionAdapter(client, name) {
  assert.match(name, /^composition_[a-z_]+$/u);
  let active = false;
  return { query: async (sql, params) => {
    if (sql === "BEGIN" || sql === "BEGIN ISOLATION LEVEL READ COMMITTED") {
      assert.equal(active, false, "nested fixture transaction");
      await client.query(`SAVEPOINT ${name}`); active = true; return { rows: [] };
    }
    if (sql === "COMMIT" || sql === "ROLLBACK") {
      assert.equal(active, true, "unbalanced fixture transaction");
      if (sql === "ROLLBACK") await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      const result = await client.query(`RELEASE SAVEPOINT ${name}`); active = false; return result;
    }
    assert.doesNotMatch(sql, /^\s*(?:BEGIN|START TRANSACTION|COMMIT|END|ROLLBACK(?! TO SAVEPOINT))\b/iu,
      "unreviewed fixture transaction control");
    return client.query(sql, params);
  } };
}

export async function compositionRowFingerprint(client) {
  const { rows: tables } = await client.query(`SELECT relname FROM pg_catalog.pg_class
    WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') ORDER BY relname`);
  const result = [];
  for (const { relname } of tables) {
    const quoted = `"${relname.replaceAll('"', '""')}"`;
    const { rows: [state] } = await client.query(`SELECT count(*)::text AS count,
      md5(COALESCE(string_agg(to_jsonb(r)::text, E'\\n' ORDER BY to_jsonb(r)::text),'')) AS digest
      FROM public.${quoted} r`);
    result.push({ table: relname, ...state });
  }
  return result;
}

export async function proveComposedLabelClock(client) {
  await client.query("SAVEPOINT composition_label");
  try {
    await client.query("SET LOCAL TIME ZONE 'America/Los_Angeles'");
    const ids = await caseLifecycleFixture(client);
    const claim = `order-label-claim:${randomUUID()}`;
    await client.query(`UPDATE public."Order" SET "labelStatus"='PURCHASED',
      "labelClaimId"=$2,"labelClaimGeneration"=1,"labelClaimStatus"='PROVIDER_RECORDED',
      "labelClaimActorUserId"=$3,"labelClaimRateObjectId"='composition-rate',
      "labelClaimExpectedAmountCents"=100,"labelClaimCurrency"='usd',
      "labelClaimStartedAt"=timezone('UTC',now())-interval '2 hours',
      "labelClaimProviderRecordedAt"=timezone('UTC',now())-interval '2 hours',
      "labelCostCents"=100,"shippoTransactionId"='composition-transaction',
      "stripeTransferId"='composition-transfer',"labelPurchasedAt"=timestamp '2026-09-07 04:05:06.789',
      "labelClawbackStatus"='RETRY_PENDING',"labelClawbackGeneration"=1,
      "labelClawbackNextAttemptAt"=timezone('UTC',now())-interval '1 minute'
      WHERE id=$1`, [ids.order, claim, ids.seller]);
    const { rows: [{ result: claims }] } = await caseLifecycleRuntime(client,
      "SELECT public.grainline_order_label_clawback_claim_batch(50) AS result");
    const selected = claims.find((row) => row.orderId === ids.order);
    assert.ok(selected, "synthetic label was not claimed");
    assert.equal(new Date(selected.labelPurchasedAt).toISOString(), "2026-09-07T04:05:06.789Z");
    const sql = "SELECT public.grainline_order_label_clawback_finalize($1,$2,1,$3,$4,$5,NULL) AS result";
    const args = [ids.order, claim, selected.clawbackGeneration];
    const snapshot = async () => (await client.query('SELECT to_jsonb(o) AS row FROM public."Order" o WHERE id=$1', [ids.order])).rows;
    const before = await snapshot();
    await assert.rejects(caseLifecycleRuntime(client, sql, [...args, null, null]),
      (error) => error.code === "22023" && error.message.includes("clawback result input is invalid"));
    assert.deepEqual(await snapshot(), before);
    assert.equal((await caseLifecycleRuntime(client, sql, [...args, "SUCCESS", "composition-reversal"])).rows[0].result.outcome, "finalized");
    const after = await snapshot();
    assert.equal(after[0].row.labelClawbackReversalId, "composition-reversal");
    assert.equal((await caseLifecycleRuntime(client, sql, [...args, "SUCCESS", "composition-reversal"])).rows[0].result.reason, "stale_claim");
    assert.deepEqual(await snapshot(), after);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    return { utcClock: true, nullRejectedWithoutMutation: true, successAndRetry: true };
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT composition_label");
    await client.query("RELEASE SAVEPOINT composition_label");
  }
}

export async function proveCompositionBehavior(client, phase) {
  // These calls use SET LOCAL ROLE with savepoint recovery. They intentionally
  // do NOT claim a distinct SESSION_USER, authenticated route or provider proof.
  const roleCalls = { query: (sql, params) => /^(?:SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT) /u.test(sql)
    ? client.query(sql, params) : caseLifecycleRuntime(client, sql, params) };
  const input = await proveInputRuntimeCalls(compositionTransactionAdapter(roleCalls, "composition_inputs"), phase);
  for (const [index, scenario] of caseLifecycleScenarios.entries()) {
    phase(`case-${index + 1}`); await runCaseLifecycleScenario(client, scenario);
  }
  phase("label-clock-finalizer");
  const label = await proveComposedLabelClock(client);
  phase("reservation-outcomes");
  const repair = await proveRepairOutcomeScenarios(compositionTransactionAdapter(client, "composition_fixture"), roleCalls, phase);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  return { input, caseScenarios: caseLifecycleScenarios.length, label, repair };
}

export async function proveCompositionTransaction(client, phase = () => {}) {
  const bundle = correctionCompositionBundle();
  const before = await repairProofCatalog(client);
  const rowsBefore = await compositionRowFingerprint(client);
  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  try {
    const definitions = [];
    for (const entry of bundle) {
      phase(`apply-${entry.name}`);
      await client.query(entry.payload);
      definitions.push(...entry.definitions);
      assertOnlyInputBodiesChanged(before, await repairProofCatalog(client), definitions);
    }
    const behavior = await proveCompositionBehavior(client, phase);
    phase("final-nine-body-catalog");
    assertOnlyInputBodiesChanged(before, await repairProofCatalog(client), definitions);
    // A mixed/already-corrected restart must not be interpreted as a fresh
    // predecessor. Each exact draft must fail its before-attestation on replay.
    for (const entry of bundle) {
      await client.query("SAVEPOINT composition_replay");
      try {
        await assert.rejects(client.query(entry.payload),
          (error) => error.code === "P0001" && /before .*authority drifted/u.test(error.message));
      } finally {
        await client.query("ROLLBACK TO SAVEPOINT composition_replay");
        await client.query("RELEASE SAVEPOINT composition_replay");
      }
    }
    assertOnlyInputBodiesChanged(before, await repairProofCatalog(client), definitions);
    return { status: "passed", packages: 6, correctedFunctions: 9, replayDenials: 6, ...behavior,
      rolledBack: true, actualRuntimeLoginProven: false, providerEffectsProved: false, productionChanged: false };
  } finally {
    try {
      await client.query("ROLLBACK");
      assert.ok(isDeepStrictEqual(await repairProofCatalog(client), before), "composition rollback left catalog residue");
      assert.ok(isDeepStrictEqual(await compositionRowFingerprint(client), rowsBefore), "composition rollback left row residue");
    } catch (error) { phase("rollback-and-verify"); throw error; }
  }
}

export async function runCompositionProof(env = process.env, phase = () => {}) {
  const { databaseUrl } = parseCompositionProofConfig(env);
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000,
    statement_timeout: 30000, query_timeout: 35000, application_name: "order-correction-composition-proof" });
  await client.connect();
  const prefix = () => proveOrderZeroDirectCompatiblePrefixPostgres({ ORDER_ZERO_DIRECT_COMPATIBLE_PREFIX_PROOF_DATABASE_URL: databaseUrl });
  try {
    phase("identity-and-prefix");
    await verifyInputRuntimeIdentity(client, "grainline_ci", "ci", env.GITHUB_ACTIONS === "true");
    await verifyRepairProofRole(client, true);
    await prefix();
    try { return await proveCompositionTransaction(client, phase); }
    finally {
      try { await prefix(); }
      catch (error) { phase("strict-prefix-after-rollback"); throw error; }
    }
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let phase = "configuration-or-connection";
  try { process.stdout.write(`${JSON.stringify(await runCompositionProof(process.env, (value) => { phase = value; }))}\n`); }
  catch (error) {
    const code = /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : "ASSERTION_OR_CONNECTION";
    process.stderr.write(`Disposable Order correction composition failed closed at ${phase} [${code}].\n`);
    process.exitCode = 1;
  }
}

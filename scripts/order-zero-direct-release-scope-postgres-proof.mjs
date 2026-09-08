// Disposable-CI reader proof only. No production URL admission or mutations.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createOrderZeroDirectReleaseScope } from "./order-zero-direct-release-scope.mjs";
import { createCorrectionReleasePackage, CORRECTION_RELEASE_LEDGER_QUERY } from "./order-correction-release-package.mjs";
import { correctionProofHistoricalLedger } from "./order-correction-release-package-postgres-proof.mjs";
import { parseInputDraftProofConfig } from "./order-input-correction-drafts-postgres-proof.mjs";
import { verifyInputRuntimeIdentity } from "./order-input-correction-runtime-postgres-proof.mjs";
import { verifyRepairProofRole } from "./checkout-repair-outcome-runtime-postgres-proof.mjs";

export function parseZeroDirectScopeProofConfig(env = process.env) {
  return parseInputDraftProofConfig({ ORDER_INPUT_CORRECTION_DRAFTS_PROOF_DATABASE_URL:
    env.ORDER_ZERO_DIRECT_RELEASE_SCOPE_PROOF_DATABASE_URL });
}

// Requires a fresh dedicated connection admitted by the CI-only entrypoint.
// The sole modeled field family is the reviewed production historical ledger
// exceptions. No production owner mapping, target substitution or ledger writes.
export async function proveZeroDirectReleaseScope(client) {
  const scope = createOrderZeroDirectReleaseScope();
  const correction = createCorrectionReleasePackage();
  let reads = 0;
  const owner = { query: async (sql, args) => {
    const result = await client.query(sql, args);
    if (sql !== CORRECTION_RELEASE_LEDGER_QUERY) return result;
    reads += 1;
    return { ...result, rows: correctionProofHistoricalLedger(result.rows, correction.manifest) };
  } };
  const snapshot = await scope.readSnapshot(owner, "after", "disposable");
  assert.equal(reads, 1);
  const plan = scope.plan(snapshot, "disposable");
  assert.equal(plan.remainingMigrations.length, 0);
  assert.equal(plan.steps.includes("apply-only-remaining-prefix"), false);
  return { status: "passed", prefixLength: 17, targetFunctions: snapshot.functions.length,
    checkedTables: snapshot.tables.length, migrationLedgerMutated: false, historicalLedgerModeled: true,
    ownerIdentityModeled: false, engineReadOnly: true, rolledBack: true,
    actualRuntimeLoginProven: false, completeProductionScope: false,
    productionExecutionAuthorized: false, productionChanged: false };
}

export async function runZeroDirectReleaseScopeProof(env = process.env, phase = () => {}) {
  const { databaseUrl } = parseZeroDirectScopeProofConfig(env);
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000,
    statement_timeout: 30000, query_timeout: 35000, application_name: "order-zero-direct-release-scope-proof" });
  await client.connect();
  try {
    phase("disposable-owner-identity");
    await verifyInputRuntimeIdentity(client, "grainline_ci", "ci", env.GITHUB_ACTIONS === "true");
    await verifyRepairProofRole(client, true);
    phase("complete-prefix-catalog");
    return await proveZeroDirectReleaseScope(client);
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let phase = "configuration-or-connection";
  try { process.stdout.write(`${JSON.stringify(await runZeroDirectReleaseScopeProof(process.env, value => { phase = value; }))}\n`); }
  catch (error) {
    const code = /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : "ASSERTION_OR_CONNECTION";
    process.stderr.write(`Disposable zero-direct release scope failed closed at ${phase} [${code}].\n`);
    process.exitCode = 1;
  }
}

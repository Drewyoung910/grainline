import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { buildCaseLifecycleCorrection, caseLifecycleDefinitions } from "./build-case-lifecycle-correction.mjs";
import { caseLifecycleScenarios, runCaseLifecycleScenario } from "./case-lifecycle-correction-scenarios.mjs";
import { parseInputDraftProofConfig, inputDraftCatalog, assertOnlyInputBodiesChanged } from "./order-input-correction-drafts-postgres-proof.mjs";
import { proofServerHostAccepted } from "./disposable-postgres-proof-host.mjs";
import { proveOrderZeroDirectCompatiblePrefixPostgres } from "./order-zero-direct-compatible-prefix-postgres-proof.mjs";

export function parseCaseLifecycleProofConfig(env = process.env) {
  return parseInputDraftProofConfig({ ORDER_INPUT_CORRECTION_DRAFTS_PROOF_DATABASE_URL:
    env.CASE_LIFECYCLE_CORRECTION_PROOF_DATABASE_URL });
}
export function caseLifecycleProofPayload() {
  const sql = readFileSync("docs/rls-drafts/case-lifecycle-correction.sql", "utf8");
  assert.equal(sql.trimEnd(), buildCaseLifecycleCorrection().trimEnd());
  const boundary = "\nBEGIN;\nSET LOCAL lock_timeout";
  assert.equal(sql.split(boundary).length, 2);
  assert.match(sql, /\nCOMMIT;\s*$/u);
  return sql.replace(boundary, "\nSET LOCAL lock_timeout").replace(/\nCOMMIT;\s*$/u, "\n");
}
export async function proveCaseLifecycleTransaction(client, onPhase = () => {}) {
  const before = await inputDraftCatalog(client);
  await client.query("BEGIN");
  try {
    onPhase("apply-two-draft-bodies");
    await client.query(caseLifecycleProofPayload());
    assertOnlyInputBodiesChanged(before, await inputDraftCatalog(client), caseLifecycleDefinitions());
    for (const [index, scenario] of caseLifecycleScenarios.entries()) {
      onPhase(`scenario-${index + 1}`);
      await runCaseLifecycleScenario(client, scenario);
    }
    onPhase("catalog-after-scenarios");
    assertOnlyInputBodiesChanged(before, await inputDraftCatalog(client), caseLifecycleDefinitions());
  } finally {
    await client.query("ROLLBACK");
  }
  onPhase("catalog-after-rollback");
  assert.deepEqual(await inputDraftCatalog(client), before, "Case lifecycle draft left catalog residue");
  return { status: "passed", functionCount: 2, scenarios: caseLifecycleScenarios.length, rolledBack: true };
}
export async function runCaseLifecycleProof(env = process.env, onPhase = () => {}) {
  const { databaseUrl } = parseCaseLifecycleProofConfig(env);
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000,
    statement_timeout: 30000, query_timeout: 35000 });
  await client.connect();
  try {
    onPhase("identity");
    const { rows: [identity] } = await client.query(`SELECT current_database() AS db,
      CURRENT_USER AS actor, SESSION_USER AS login, current_setting('server_version_num')::integer AS version,
      pg_catalog.host(pg_catalog.inet_server_addr()) AS host`);
    assert.equal(identity.db, "grainline_ci");
    assert.equal(identity.actor, "ci");
    assert.equal(identity.login, "ci");
    assert.ok(identity.version >= 160000 && identity.version < 170000);
    assert.ok(proofServerHostAccepted(identity.host, env.GITHUB_ACTIONS === "true"));
    const prefixEnv = { ORDER_ZERO_DIRECT_COMPATIBLE_PREFIX_PROOF_DATABASE_URL: databaseUrl };
    onPhase("prefix-before");
    await proveOrderZeroDirectCompatiblePrefixPostgres(prefixEnv);
    const result = await proveCaseLifecycleTransaction(client, onPhase);
    onPhase("prefix-after-rollback");
    await proveOrderZeroDirectCompatiblePrefixPostgres(prefixEnv);
    return { ...result, productionChanged: false, actualRuntimeLoginProven: false };
  } finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let phase = "configuration-or-connection";
  try { process.stdout.write(`${JSON.stringify(await runCaseLifecycleProof(process.env, (value) => { phase = value; }))}\n`); }
  catch (error) {
    const code = /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : "ASSERTION_OR_CONNECTION";
    process.stderr.write(`Disposable Case lifecycle correction proof failed closed at ${phase} [${code}].\n`);
    process.exitCode = 1;
  }
}

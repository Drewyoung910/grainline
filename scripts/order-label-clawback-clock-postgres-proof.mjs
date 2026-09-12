import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { buildOrderLabelClawbackClock, orderLabelClawbackClockDefinition } from "./build-order-label-clawback-clock.mjs";
import { parseInputDraftProofConfig, proveInputDraftTransaction } from "./order-input-correction-drafts-postgres-proof.mjs";
import { proofServerHostAccepted } from "./disposable-postgres-proof-host.mjs";
import { proveOrderZeroDirectCompatiblePrefixPostgres } from "./order-zero-direct-compatible-prefix-postgres-proof.mjs";

export function parseClawbackClockProofConfig(env = process.env) {
  return parseInputDraftProofConfig({ ORDER_INPUT_CORRECTION_DRAFTS_PROOF_DATABASE_URL:
    env.ORDER_LABEL_CLAWBACK_CLOCK_PROOF_DATABASE_URL });
}
export function clawbackClockProofBundle() {
  const sql = readFileSync("docs/rls-drafts/order-label-clawback-clock.sql", "utf8");
  assert.equal(sql.trimEnd(), buildOrderLabelClawbackClock().trimEnd());
  const boundary = "\nBEGIN;\nSET LOCAL lock_timeout";
  assert.equal(sql.split(boundary).length, 2);
  assert.match(sql, /\nCOMMIT;\s*$/u);
  const payload = sql.replace(boundary, "\nSET LOCAL lock_timeout").replace(/\nCOMMIT;\s*$/u, "\n");
  return [{ name: "label-clawback-clock", payload, definitions: [orderLabelClawbackClockDefinition()] }];
}
export async function runClawbackClockProof(env = process.env, onPhase = () => {}) {
  const { databaseUrl } = parseClawbackClockProofConfig(env);
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
    const result = await proveInputDraftTransaction(client, clawbackClockProofBundle(), onPhase);
    onPhase("prefix-after-rollback");
    await proveOrderZeroDirectCompatiblePrefixPostgres(prefixEnv);
    return { ...result, productionChanged: false };
  } finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let phase = "configuration-or-connection";
  try { process.stdout.write(`${JSON.stringify(await runClawbackClockProof(process.env, (value) => { phase = value; }))}\n`); }
  catch (error) {
    const code = /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : "ASSERTION_OR_CONNECTION";
    process.stderr.write(`Disposable label clawback clock proof failed closed at ${phase} [${code}].\n`);
    process.exitCode = 1;
  }
}

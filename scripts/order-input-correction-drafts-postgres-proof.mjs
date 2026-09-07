import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { proofServerHostAccepted } from "./disposable-postgres-proof-host.mjs";
import {
  buildOrderLabelOutcomeCorrection, orderLabelOutcomeDefinitions,
} from "./build-order-label-outcome-correction.mjs";
import {
  buildOrderReconciliationInputCorrection, orderReconciliationInputDefinitions,
} from "./build-order-reconciliation-input-corrections.mjs";
import { proveOrderZeroDirectCompatiblePrefixPostgres } from "./order-zero-direct-compatible-prefix-postgres-proof.mjs";

const ENV = "ORDER_INPUT_CORRECTION_DRAFTS_PROOF_DATABASE_URL";

export function parseInputDraftProofConfig(env = process.env) {
  const databaseUrl = env[ENV];
  assert.ok(databaseUrl, "disposable input-draft proof URL is required");
  const url = new URL(databaseUrl);
  assert.equal(url.protocol, "postgresql:");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "proof requires loopback");
  assert.equal(url.pathname, "/grainline_ci");
  assert.equal(decodeURIComponent(url.username), "ci");
  assert.ok(url.port === "" || url.port === "5432", "proof requires the disposable CI port");
  assert.ok(url.search === "" || url.search === "?sslmode=disable", "proof rejects connection overrides");
  assert.equal(url.hash, "");
  return { databaseUrl };
}

export function inputDraftBundle() {
  return [
    ["order-label-outcome-correction", buildOrderLabelOutcomeCorrection(), orderLabelOutcomeDefinitions()],
    ["order-refund-reconciliation-input-correction", buildOrderReconciliationInputCorrection("refund"), orderReconciliationInputDefinitions("refund")],
    ["order-receipt-notification-type-correction", buildOrderReconciliationInputCorrection("notification"), orderReconciliationInputDefinitions("notification")],
  ].map(([name, generated, definitions]) => {
    const sql = readFileSync(`docs/rls-drafts/${name}.sql`, "utf8");
    assert.equal(sql.trimEnd(), generated.trimEnd(), `${name} draft bytes drifted`);
    // Run the exact generated attestation/DDL payload inside OUR rollback-only
    // transaction. Never send a draft's outer COMMIT to the database.
    const boundary = "\nBEGIN;\nSET LOCAL lock_timeout";
    assert.equal(sql.split(boundary).length, 2);
    assert.match(sql, /\nCOMMIT;\s*$/u);
    const payload = sql.replace(boundary, "\nSET LOCAL lock_timeout").replace(/\nCOMMIT;\s*$/u, "\n");
    return { name, payload, definitions };
  });
}

export async function inputDraftCatalog(client) {
  const { rows } = await client.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace) AS functions,
    -- Ignore physical vacuum/statistics counters, not logical schema or ACLs.
    (SELECT jsonb_agg(to_jsonb(c) - ARRAY['relpages', 'reltuples', 'relallvisible',
      'relallfrozen', 'relfrozenxid', 'relminmxid'] ORDER BY c.oid) FROM pg_catalog.pg_class c
      WHERE c.relnamespace = 'public'::regnamespace) AS relations,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid, a.attnum) FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'public'::regnamespace) AS columns,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_policy p) AS policies,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_catalog.pg_roles r) AS roles,
    (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_catalog.pg_default_acl d) AS defaults,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public._prisma_migrations m) AS migrations`);
  return rows[0];
}

export function assertOnlyInputBodiesChanged(before, after, definitions) {
  const expected = structuredClone(before);
  for (const { name, tag, before: original, after: corrected } of definitions) {
    // Each reviewed target has exactly one overload in this candidate. Do not
    // accept a substitute overload simply because its name matches.
    const matches = expected.functions.filter((f) => f.proname === name);
    assert.equal(matches.length, 1, `${name} overload inventory drifted`);
    assert.equal(matches[0].prosrc, original.split(tag)[1], `${name} predecessor drifted`);
    matches[0].prosrc = corrected.split(tag)[1];
  }
  assert.deepEqual(after, expected, "draft changed more than the exact reviewed function bodies");
}

export async function proveInputDraftTransaction(client, bundle = inputDraftBundle(), onPhase = () => {}) {
  onPhase("catalog-before");
  const before = await inputDraftCatalog(client);
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    for (const { name, payload } of bundle) {
      onPhase(`apply-${name}`);
      await client.query(payload);
    }
    onPhase("catalog-compare");
    assertOnlyInputBodiesChanged(before, await inputDraftCatalog(client), bundle.flatMap((d) => d.definitions));
  } finally {
    // A rollback error is a failure, not a successful cleanup claim.
    await client.query("ROLLBACK");
  }
  onPhase("catalog-after-rollback");
  assert.deepEqual(await inputDraftCatalog(client), before, "draft rollback left catalog residue");
  return { status: "passed", draftCount: bundle.length,
    functionCount: bundle.flatMap((d) => d.definitions).length, rolledBack: true };
}

export async function runInputDraftProof(env = process.env, onPhase = () => {}) {
  const config = parseInputDraftProofConfig(env);
  const client = new pg.Client({ connectionString: config.databaseUrl,
    connectionTimeoutMillis: 10000, statement_timeout: 30000, query_timeout: 35000 });
  await client.connect();
  try {
    onPhase("identity");
    const { rows: [identity] } = await client.query(`SELECT current_database() AS db,
      CURRENT_USER AS actor, SESSION_USER AS login,
      current_setting('server_version_num')::integer AS version,
      pg_catalog.host(pg_catalog.inet_server_addr()) AS host`);
    assert.equal(identity.db, "grainline_ci");
    assert.equal(identity.actor, "ci");
    assert.equal(identity.login, "ci");
    assert.ok(identity.version >= 160000 && identity.version < 170000, "proof requires PostgreSQL 16");
    assert.ok(proofServerHostAccepted(identity.host, env.GITHUB_ACTIONS === "true"), "proof server is not disposable loopback/CI");
    // Existing complete-prefix checks run before AND after; their historical
    // expected sources and ledger are not expanded to accept these drafts.
    const prefixEnv = { ORDER_ZERO_DIRECT_COMPATIBLE_PREFIX_PROOF_DATABASE_URL: config.databaseUrl };
    onPhase("prefix-before");
    await proveOrderZeroDirectCompatiblePrefixPostgres(prefixEnv);
    const result = await proveInputDraftTransaction(client, inputDraftBundle(), onPhase);
    onPhase("prefix-after-rollback");
    await proveOrderZeroDirectCompatiblePrefixPostgres(prefixEnv);
    return { ...result, productionChanged: false };
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let phase = "configuration-or-connection";
  try { process.stdout.write(`${JSON.stringify(await runInputDraftProof(process.env, (value) => { phase = value; }))}\n`); }
  catch (error) {
    // Catalog assertions contain complete function bodies. Do not dump those,
    // connection strings or driver internals into workflow logs.
    const code = /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : "ASSERTION_OR_CONNECTION";
    process.stderr.write(`Disposable Order input-draft composition proof failed closed at ${phase} [${code}]; no production target is permitted.\n`);
    process.exitCode = 1;
  }
}

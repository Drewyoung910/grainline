// Disposable-only adapter for the SAME executor used by the dormant worker.
// Never admits production URLs or relaxes the production scope validator.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { executeOrderZeroDirectPrefix } from "./order-zero-direct-execution.mjs";
import { runOrderPrefixPrisma } from "./order-zero-direct-execution-prisma.mjs";
import { CORRECTION_RELEASE_LEDGER_QUERY } from "./order-correction-release-package.mjs";
import { correctionProofAppliedRow, correctionProofHistoricalLedger } from "./order-correction-release-package-postgres-proof.mjs";
import { parseInputDraftProofConfig } from "./order-input-correction-drafts-postgres-proof.mjs";
import { verifyInputRuntimeIdentity } from "./order-input-correction-runtime-postgres-proof.mjs";

export function disposablePrefixHistory(rows, manifest) {
  const full = [...manifest.base, ...manifest.members];
  assert.ok(rows.length >= 234 && rows.length <= 251);
  const n = rows.length - 234;
  for (const expected of full.slice(0, rows.length)) {
    const matches = rows.filter(row => row.migration_name === expected.migration_name);
    assert.ok(matches.length === 1 && matches[0].checksum === expected.checksum
      && matches[0].finished_at != null && matches[0].rolled_back_at === null && matches[0].applied_steps_count === 1);
  }
  // Only the three historical representations are modeled. Temporary padding
  // lets the unchanged historical fixture helper validate the full catalog;
  // every padded suffix row is removed before the actual classifier sees it.
  const absent = new Set(manifest.members.slice(n).map(row => row.migration_name));
  return correctionProofHistoricalLedger([...rows, ...manifest.members.slice(n).map(row => correctionProofAppliedRow(row.migration_name, row.checksum))],
    { predecessor: full }).filter(row => !absent.has(row.migration_name));
}

export async function runDisposableOrderExecution({ sourceRoot, scope, files, binding, parent, databaseUrl, githubActions = false, guard }) {
  parseInputDraftProofConfig({ ORDER_INPUT_CORRECTION_DRAFTS_PROOF_DATABASE_URL: databaseUrl });
  // Numeric loopback prevents hostname resolution from redirecting this writer.
  assert.equal(new URL(databaseUrl).hostname, "127.0.0.1");
  assert.equal(fs.realpathSync(parent), parent);
  const connect = async () => {
    const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000,
      statement_timeout: 30000, query_timeout: 35000, application_name: "order-bounded-executor-disposable" });
    client.on("error", () => {}); // Query/connection promises carry sanitized failures.
    try {
      await client.connect(); await verifyInputRuntimeIdentity(client, "grainline_ci", "ci", githubActions);
      const role = (await client.query("SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=CURRENT_USER")).rows;
      assert.ok(role.length === 1 && role[0].rolsuper === true);
      return client;
    } catch { await client.end(); throw new Error("disposable execution identity rejected"); }
  };
  const readAudited = async () => {
    await guard();
    const client = await connect();
    try {
      const wrapped = { query: async (sql, args) => {
        const result = await client.query(sql, args);
        return sql === CORRECTION_RELEASE_LEDGER_QUERY ? { ...result, rows: disposablePrefixHistory(result.rows, scope.manifest) } : result;
      } };
      return await scope.readAuditedSnapshot(wrapped, "restart", "disposable");
    } finally { await client.end(); }
  };
  const before = await readAudited();
  const artifact = files.stage(before.ledgerRows, parent);
  const journalDirectory = fs.mkdtempSync(path.join(parent, "execution-journal-")); fs.chmodSync(journalDirectory, 0o700);
  const prisma = (args, checkpoint) => runOrderPrefixPrisma({ sourceRoot, parent, databaseUrl, args, checkpoint });
  return executeOrderZeroDirectPrefix({ sourceRoot, scope, files, artifact, binding, parent, journalDirectory,
    guard, readAudited, connect, prisma, mode: "disposable" });
}

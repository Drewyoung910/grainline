import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createCorrectionReleasePackage, CORRECTION_RELEASE_LEDGER_QUERY } from "./order-correction-release-package.mjs";
import { correctionCompositionBundle } from "./order-correction-composition-manifest.mjs";
import { parseInputDraftProofConfig } from "./order-input-correction-drafts-postgres-proof.mjs";
import { verifyInputRuntimeIdentity } from "./order-input-correction-runtime-postgres-proof.mjs";
import { repairProofCatalog, verifyRepairProofRole } from "./checkout-repair-outcome-runtime-postgres-proof.mjs";
import { compositionRowFingerprint } from "./order-correction-composition-postgres-proof.mjs";
import { LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS, LISTING_VARIANTS_REVIEWED_MIGRATION } from "./direct-upload-activation-failure-inspect.mjs";
import { DIRECT_UPLOAD_ACTIVATION_RELEASE, FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256 } from "./verify-direct-upload-activation-release.mjs";
import { SCHEMA_NUMERIC_GUARDS_MIGRATION, SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256 } from "./verify-seller-payout-event-authority-production-scope.mjs";

export function correctionProofAppliedRow(migration_name, checksum) {
  return { migration_name, checksum, finished_at: new Date("2026-09-08T00:00:00Z"),
    rolled_back_at: null, applied_steps_count: 1 };
}

// Disposable fixture conversion ONLY: the fresh CI ledger has no failed/alias
// history. First require exactly its known current bytes, then model the three
// already-reviewed historical production representations in memory. Do not write
// _prisma_migrations, export production rows or infer production acceptance.
export function correctionProofHistoricalLedger(rows, manifest) {
  assert.equal(rows.length, manifest.predecessor.length, "CI predecessor ledger count drifted");
  for (const e of manifest.predecessor) {
    const matches = rows.filter((r) => r.migration_name === e.migration_name);
    assert.ok(matches.length === 1 && matches[0].checksum === e.checksum
      && matches[0].finished_at != null && matches[0].rolled_back_at === null
      && matches[0].applied_steps_count === 1, "CI predecessor row drifted");
  }
  const modeled = structuredClone(rows);
  modeled.find((r) => r.migration_name === SCHEMA_NUMERIC_GUARDS_MIGRATION).checksum = SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256;
  for (const [migration_name, checksum] of [
    [LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS, rows.find((r) => r.migration_name === LISTING_VARIANTS_REVIEWED_MIGRATION).checksum],
    [DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName, FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256],
  ]) modeled.push({ migration_name, checksum, finished_at: null,
    rolled_back_at: new Date("2026-09-08T00:00:00Z"), applied_steps_count: 0 });
  return modeled;
}

export function parseCorrectionReleaseProofConfig(env = process.env) {
  return parseInputDraftProofConfig({ ORDER_INPUT_CORRECTION_DRAFTS_PROOF_DATABASE_URL:
    env.ORDER_CORRECTION_RELEASE_PACKAGE_PROOF_DATABASE_URL });
}

export async function proveCorrectionReleasePackage(client, phase = () => {}) {
  phase("source-package");
  const release = createCorrectionReleasePackage();
  phase("predecessor-ledger");
  const rawLedger = (await client.query(CORRECTION_RELEASE_LEDGER_QUERY)).rows;
  const modeledLedger = correctionProofHistoricalLedger(rawLedger, release.manifest);
  phase("before-fingerprints");
  const before = await repairProofCatalog(client);
  const beforeRows = await compositionRowFingerprint(client);
  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  try {
    const counts = { "order-compatible": 0, "case-reader-first": 0, "reservation-integrity-separate": 0 };
    const request = (boundary) => ({ boundary, stage: "restart",
      companions: Object.fromEntries(Object.entries(counts).filter(([key]) => key !== boundary)) });
    const read = async () => {
      const rows = await release.readTargets(client);
      // Real disposable owner must be ci before the production-owner fixture mapping.
      assert.ok(rows.every((r) => r.owner_name === "ci"), "CI target owner drifted");
      return rows.map((r) => ({ ...r, owner_name: "neondb_owner" }));
    };
    let checkedStates = 0; let mismatchDenials = 0;
    phase("before-target-snapshot");
    let functions = await read();
    release.assertSnapshot({ ledgerRows: modeledLedger, functionRows: functions }, request("order-compatible"));
    checkedStates += 1;
    const bundle = correctionCompositionBundle();
    for (const [index, entry] of bundle.entries()) {
      phase(`package-${index + 1}`);
      const pkg = release.manifest.packages[index];
      const row = correctionProofAppliedRow(pkg.migration_name, pkg.checksum);
      // Ledger says applied but old body remains; then new body without ledger.
      assert.throws(() => release.assertSnapshot({ ledgerRows: [...modeledLedger, row], functionRows: functions }, request(pkg.boundary)));
      await client.query(entry.payload);
      functions = await read();
      assert.throws(() => release.assertSnapshot({ ledgerRows: modeledLedger, functionRows: functions }, request(pkg.boundary)));
      mismatchDenials += 2;
      modeledLedger.push(row); counts[pkg.boundary] += 1;
      release.assertSnapshot({ ledgerRows: modeledLedger, functionRows: functions }, request(pkg.boundary));
      checkedStates += 1;
    }
    phase("complete-boundary-snapshots");
    for (const boundary of Object.keys(counts)) {
      const result = release.assertSnapshot({ ledgerRows: modeledLedger, functionRows: functions }, { ...request(boundary), stage: "after" });
      assert.equal(result.remainingMigrations.length, 0);
    }
    phase("unchanged-migration-ledger");
    assert.deepEqual((await client.query(CORRECTION_RELEASE_LEDGER_QUERY)).rows, rawLedger);
    return { status: "passed", checkedStates, mismatchDenials, migrationLedgerMutated: false,
      historicalLedgerModeled: true, ownerIdentityModeled: true, actualRuntimeLoginProven: false,
      productionExecutionAuthorized: false, productionChanged: false, rolledBack: true };
  } finally {
    try {
      await client.query("ROLLBACK");
      assert.ok(isDeepStrictEqual(await repairProofCatalog(client), before), "release proof left catalog residue");
      assert.ok(isDeepStrictEqual(await compositionRowFingerprint(client), beforeRows), "release proof left row residue");
    } catch (error) { phase("rollback-verification"); throw error; }
  }
}

export async function runCorrectionReleaseProof(env = process.env, phase = () => {}) {
  const { databaseUrl } = parseCorrectionReleaseProofConfig(env);
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000,
    statement_timeout: 30000, query_timeout: 35000, application_name: "correction-release-package-proof" });
  await client.connect();
  try {
    phase("disposable-owner-identity");
    await verifyInputRuntimeIdentity(client, "grainline_ci", "ci", env.GITHUB_ACTIONS === "true");
    phase("disposable-runtime-posture");
    await verifyRepairProofRole(client, true);
    return await proveCorrectionReleasePackage(client, phase);
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let phase = "configuration-or-connection";
  try { process.stdout.write(`${JSON.stringify(await runCorrectionReleaseProof(process.env, (value) => { phase = value; }))}\n`); }
  catch (error) {
    const code = /^[A-Z0-9]{5}$/u.test(error?.code ?? "") ? error.code : "ASSERTION_OR_CONNECTION";
    process.stderr.write(`Disposable correction release package failed closed at ${phase} [${code}].\n`);
    process.exitCode = 1;
  }
}

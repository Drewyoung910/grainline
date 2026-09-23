// Fixed executor core. Its owning worker supplies private live guards and
// connection/command adapters; observations passed through IPC are not guards.
// Production dispatch remains unavailable. Disposable proof uses this same core.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createOrderExecutionJournal } from "./order-zero-direct-execution-journal.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function orderPrefixGrantSql(manifest) {
  assert.equal(manifest.states.length, 18);
  const final = manifest.states[17]; assert.equal(final.length, 36);
  return final.map(def => {
    assert.match(def.identity, /^public\.grainline_[a-z0-9_]+\([a-z0-9 ,\[\]]*\)$/u);
    assert.equal(def.staffExecute, false);
    return `REVOKE ALL ON FUNCTION ${def.identity} FROM PUBLIC, grainline_app_runtime;\n`
      + (def.runtimeExecute ? `GRANT EXECUTE ON FUNCTION ${def.identity} TO grainline_app_runtime;\n` : "");
  }).join("");
}

function capsule(sourceRoot, artifact, parent) {
  assert.equal(fs.realpathSync(parent), parent);
  const root = fs.mkdtempSync(path.join(parent, "execution-capsule-")); fs.chmodSync(root, 0o700);
  // Prisma reads the fixed source schema, but migrations only from the opaque
  // selected artifact. It never discovers pending repository migrations.
  const config = path.join(root, "prisma.config.mjs");
  const bytes = Buffer.from(`export default ${JSON.stringify({ schema: path.join(sourceRoot, "prisma/schema.prisma"), migrations: { path: artifact.directory } }).slice(0, -1)},datasource:{url:process.env.DIRECT_URL}};\n`);
  const fd = fs.openSync(config, "wx", 0o400);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.chmodSync(root, 0o500);
  syncDirectory(root); syncDirectory(parent);
  const directoryStat = fs.lstatSync(root, { bigint: true });
  const stat = fs.lstatSync(config, { bigint: true });
  const verify = () => {
    assert.equal(fs.realpathSync(config), config);
    assert.equal(fs.lstatSync(root).mode & 0o777, 0o500);
    for (const key of ["dev", "ino", "mode", "uid"]) assert.equal(fs.lstatSync(root, { bigint: true })[key], directoryStat[key]);
    const current = fs.lstatSync(config, { bigint: true });
    assert.ok(current.isFile() && current.nlink === 1n);
    for (const key of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"]) assert.equal(current[key], stat[key]);
    assert.equal(hash(fs.readFileSync(config)), hash(bytes));
  };
  return { config, verify };
}

// This is an internal same-process composition API, not a generic RPC endpoint.
// readAudited and guard MUST execute fresh checks; no serialized verdict enters.
export async function executeOrderZeroDirectPrefix({ sourceRoot, scope, files, artifact,
  binding, parent, journalDirectory, guard, readAudited, connect, prisma, mode }) {
  let journal, phase = "initial-scope";
  try {
    assert.ok(["production", "disposable"].includes(mode));
    assert.equal(process.cwd(), sourceRoot); assert.equal(fs.realpathSync(sourceRoot), sourceRoot);
    await guard(); files.verify(artifact);
    const initial = await readAudited();
    const state = scope.assertAuditedSnapshot(initial, "restart", mode);
    assert.equal(state.prefixLength, artifact.prefixLength);
    assert.equal(artifact.sourceCatalogSha256, scope.manifest.sourceCatalogSha256);
    assert.deepEqual(artifact.remainingMigrations, scope.manifest.members.slice(state.prefixLength).map(row => row.migration_name));
    // File staging fsyncs the SQL bytes. Persist every directory entry before
    // intent can authorize a command, so crash evidence includes its artifact.
    for (const row of [...scope.manifest.base, ...scope.manifest.members]) syncDirectory(path.join(artifact.directory, row.migration_name));
    syncDirectory(artifact.directory); syncDirectory(parent); files.verify(artifact);
    const prepared = capsule(sourceRoot, artifact, parent);
    journal = createOrderExecutionJournal({ directory: journalDirectory, binding: { ...binding,
      initialPrefix: state.prefixLength, prefixCatalogSha256: scope.manifest.sourceCatalogSha256 } });
    journal.advance("prepared");
    const checkpoint = async () => { await guard(); journal.verify(); files.verify(artifact); prepared.verify(); };
    if (state.prefixLength < 17) {
      phase = "prefix-deploy";
      journal.advance("apply-intent");
      await checkpoint();
      // One reviewed contiguous suffix, retaining all 251 history files. Prisma
      // owns its migration ledger and lock. Never resolve, rewrite or replay an
      // incomplete row after any command/connection/process failure.
      await prisma(["migrate", "deploy", "--config", prepared.config], checkpoint);
    }
    phase = "prefix-reinspection";
    await checkpoint();
    scope.assertAuditedSnapshot(await readAudited(), "after", mode);
    journal.advance("prefix-verified");
    journal.advance("grant-intent");
    phase = "grant-convergence";
    await checkpoint();
    const client = await connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        await client.query(orderPrefixGrantSql(scope.manifest));
        await checkpoint(); // Lock loss before commit rolls grants back.
        await client.query("COMMIT");
      } catch { await client.query("ROLLBACK"); throw new Error("grant convergence failed"); }
    } finally { await client.end(); }
    await checkpoint();
    scope.assertAuditedSnapshot(await readAudited(), "after", mode);
    journal.advance("grants-verified");
    phase = "migration-status";
    await checkpoint(); await prisma(["migrate", "status", "--config", prepared.config], checkpoint);
    journal.advance("status-verified");
    phase = "global-audit";
    await checkpoint();
    const audited = await readAudited(); scope.assertAuditedSnapshot(audited, "after", mode);
    journal.advance("audit-verified");
    phase = "final-scope";
    await checkpoint();
    scope.assertAuditedSnapshot(await readAudited(), "after", mode);
    await checkpoint(); journal.advance("complete");
    return Object.freeze({ status: "passed", initialPrefix: state.prefixLength, finalPrefix: 17,
      appliedMemberCount: artifact.remainingMigrations.length, reviewedFunctionCount: 36,
      migrationStatusVerified: true, globalAuthorityVerified: true, finalReadOnlyScopeVerified: true,
      completeProductionScope: false, productionExecutionAuthorized: false });
  } catch {
    const error = new Error("Order bounded execution stopped; preserve journal and artifact for inspection");
    error.executionPhase = phase; throw error;
  }
  finally { journal?.close(); }
}

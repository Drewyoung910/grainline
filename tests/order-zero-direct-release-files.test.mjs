import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createOrderZeroDirectFileFence } from "../scripts/order-zero-direct-release-files.mjs";
import { createCorrectionReleasePackage } from "../scripts/order-correction-release-package.mjs";
import { correctionProofAppliedRow, correctionProofHistoricalLedger } from "../scripts/order-correction-release-package-postgres-proof.mjs";

const manifest = createCorrectionReleasePackage().manifest;
const rows = correctionProofHistoricalLedger(manifest.predecessor.map(row => correctionProofAppliedRow(row.migration_name, row.checksum)), manifest);
const members = manifest.predecessor.slice(234);
function ledger(n) {
  const absent = new Set(members.slice(n).map(row => row.migration_name));
  return structuredClone(rows.filter(row => !absent.has(row.migration_name)));
}
function removeOwned(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const item = path.join(root, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) { fs.chmodSync(item, 0o700); removeOwned(item); }
    else fs.unlinkSync(item);
  }
  fs.rmdirSync(root);
}
function fixture(t, copy = false) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "order-file-fence-test-"));
  fs.chmodSync(root, 0o700);
  const parent = path.join(root, "artifacts"); fs.mkdirSync(parent, { mode: 0o700 });
  const sourceRoot = path.join(root, "source");
  if (copy) fs.cpSync("prisma/migrations", path.join(sourceRoot, "prisma/migrations"), { recursive: true });
  t.after(() => removeOwned(root));
  return { root, parent, sourceRoot, tree: path.join(sourceRoot, "prisma/migrations") };
}

test("all 18 completed-prefix states stage exact history plus only the selected suffix", t => {
  const { parent } = fixture(t);
  const fence = createOrderZeroDirectFileFence();
  for (let n = 0; n <= 17; n += 1) {
    const artifact = fence.stage(ledger(n), parent);
    assert.equal(artifact.prefixLength, n);
    assert.equal(artifact.fileCount, 252);
    assert.deepEqual(artifact.remainingMigrations, members.slice(n).map(row => row.migration_name));
    assert.deepEqual(fs.readdirSync(artifact.directory).sort(), [...manifest.predecessor.map(row => row.migration_name), "migration_lock.toml"].sort());
    for (const row of manifest.predecessor) assert.deepEqual(
      fs.readFileSync(path.join(artifact.directory, row.migration_name, "migration.sql")),
      fs.readFileSync(`prisma/migrations/${row.migration_name}/migration.sql`));
    for (const candidate of manifest.packages) assert.equal(fs.existsSync(path.join(artifact.directory, candidate.migration_name)), false);
    assert.equal(fence.verify(artifact), artifact);
    for (const property of ["freshDatabaseScopeProven", "loadedSourceAndCiProven", "completeProductionScope", "productionExecutionAuthorized"]) assert.equal(artifact[property], false);
    assert.equal(Object.isFrozen(artifact.remainingMigrations), true);
    fs.chmodSync(artifact.directory, 0o700); removeOwned(artifact.directory);
  }
});

test("unknown, gapped, failed and partial ledgers create no artifact", t => {
  const { parent } = fixture(t); const fence = createOrderZeroDirectFileFence();
  const partial = ledger(10); const row = partial.find(r => r.migration_name === members[9].migration_name);
  row.finished_at = null; row.applied_steps_count = 0;
  const gap = ledger(4); gap.push(correctionProofAppliedRow(members[5].migration_name, members[5].checksum));
  const extra = [...ledger(17), correctionProofAppliedRow(manifest.packages[0].migration_name, manifest.packages[0].checksum)];
  for (const value of [null, [], partial, gap, extra]) assert.throws(() => fence.stage(value, parent));
  assert.deepEqual(fs.readdirSync(parent), []);
});

test("source byte drift, extras and omissions fail before staging", t => {
  const f = fixture(t, true); const fence = createOrderZeroDirectFileFence({ sourceRoot: f.sourceRoot });
  const file = path.join(f.tree, members[0].migration_name, "migration.sql"); const bytes = fs.readFileSync(file);
  fs.appendFileSync(file, "\n-- changed"); assert.throws(() => fence.stage(ledger(0), f.parent)); fs.writeFileSync(file, bytes);
  fs.writeFileSync(path.join(f.tree, "unexpected.sql"), "SELECT 1"); assert.throws(() => fence.stage(ledger(0), f.parent)); fs.unlinkSync(path.join(f.tree, "unexpected.sql"));
  const extra = path.join(path.dirname(file), "extra.sql"); fs.writeFileSync(extra, "SELECT 1"); assert.throws(() => fence.stage(ledger(0), f.parent)); fs.unlinkSync(extra);
  fs.unlinkSync(file); assert.throws(() => fence.stage(ledger(0), f.parent)); fs.writeFileSync(file, bytes);
  fs.appendFileSync(path.join(f.tree, "migration_lock.toml"), "# changed"); assert.throws(() => fence.stage(ledger(0), f.parent));
  assert.deepEqual(fs.readdirSync(f.parent), []);
});

test("source symlinks, hard links and ancestor aliases cannot redirect staged bytes", t => {
  const f = fixture(t, true);
  const file = path.join(f.tree, members[0].migration_name, "migration.sql");
  const original = path.join(f.root, "original.sql"); fs.renameSync(file, original);
  const fence = createOrderZeroDirectFileFence({ sourceRoot: f.sourceRoot });
  fs.symlinkSync(original, file); assert.throws(() => fence.stage(ledger(0), f.parent)); fs.unlinkSync(file);
  fs.linkSync(original, file); assert.throws(() => fence.stage(ledger(0), f.parent)); fs.unlinkSync(file); fs.renameSync(original, file);
  const alias = path.join(f.root, "alias"); fs.symlinkSync(f.sourceRoot, alias);
  const aliased = createOrderZeroDirectFileFence({ sourceRoot: alias }); assert.throws(() => aliased.stage(ledger(0), f.parent));
  const folder = path.dirname(file); const moved = path.join(f.root, "moved"); fs.renameSync(folder, moved); fs.symlinkSync(moved, folder);
  assert.throws(() => fence.stage(ledger(0), f.parent));
  assert.deepEqual(fs.readdirSync(f.parent), []);
});

test("artifact verification rejects tampering and unowned or copied handles", t => {
  const { parent } = fixture(t); const fence = createOrderZeroDirectFileFence();
  const artifact = fence.stage(ledger(17), parent);
  assert.throws(() => fence.verify({ ...artifact }));
  assert.throws(() => createOrderZeroDirectFileFence().verify(artifact));
  fs.chmodSync(parent, 0o755); assert.throws(() => fence.verify(artifact)); fs.chmodSync(parent, 0o700);
  const file = path.join(artifact.directory, members[0].migration_name, "migration.sql");
  fs.chmodSync(file, 0o600); assert.throws(() => fence.verify(artifact));
  fs.appendFileSync(file, "-- changed"); fs.chmodSync(file, 0o400); assert.throws(() => fence.verify(artifact));
});

test("source changes after staging invalidate the existing artifact", t => {
  const f = fixture(t, true); const fence = createOrderZeroDirectFileFence({ sourceRoot: f.sourceRoot });
  const artifact = fence.stage(ledger(6), f.parent);
  fs.appendFileSync(path.join(f.tree, members[16].migration_name, "migration.sql"), "-- changed");
  assert.throws(() => fence.verify(artifact));
});

test("special and oversized source files fail without blocking or unbounded reads", t => {
  const f = fixture(t, true); const fence = createOrderZeroDirectFileFence({ sourceRoot: f.sourceRoot });
  const file = path.join(f.tree, members[0].migration_name, "migration.sql"); fs.unlinkSync(file);
  execFileSync("mkfifo", [file]); assert.throws(() => fence.stage(ledger(0), f.parent), /regular/); fs.unlinkSync(file);
  const fd = fs.openSync(file, "wx"); try { fs.ftruncateSync(fd, 16 * 1024 * 1024 + 1); } finally { fs.closeSync(fd); }
  assert.throws(() => fence.stage(ledger(0), f.parent), /bounded read size/);
  assert.deepEqual(fs.readdirSync(f.parent), []);
});

test("unsafe artifact parents and symlinked artifacts are rejected without overwriting", t => {
  const f = fixture(t, true); const fence = createOrderZeroDirectFileFence({ sourceRoot: f.sourceRoot });
  fs.chmodSync(f.parent, 0o755); assert.throws(() => fence.stage(ledger(0), f.parent)); fs.chmodSync(f.parent, 0o700);
  const alias = path.join(f.root, "parent-alias"); fs.symlinkSync(f.parent, alias); assert.throws(() => fence.stage(ledger(0), alias));
  const inside = path.join(f.sourceRoot, "artifact"); fs.mkdirSync(inside, { mode: 0o700 }); assert.throws(() => fence.stage(ledger(0), inside));
  const a = fence.stage(ledger(0), f.parent); const b = fence.stage(ledger(0), f.parent); assert.notEqual(a.directory, b.directory);
  const moved = path.join(f.parent, "moved"); fs.chmodSync(a.directory, 0o700);
  fs.renameSync(a.directory, moved); fs.chmodSync(moved, 0o500); fs.symlinkSync(moved, a.directory);
  assert.throws(() => fence.verify(a)); assert.equal(fence.verify(b), b);
});

test("staged additions, missing files and linked replacements cannot pass revalidation", t => {
  const { parent, root } = fixture(t); const fence = createOrderZeroDirectFileFence();
  const artifact = fence.stage(ledger(9), parent);
  fs.chmodSync(artifact.directory, 0o700);
  const extra = path.join(artifact.directory, "unselected.sql"); fs.writeFileSync(extra, "SELECT 1");
  fs.chmodSync(artifact.directory, 0o500); assert.throws(() => fence.verify(artifact));
  fs.chmodSync(artifact.directory, 0o700); fs.unlinkSync(extra); fs.chmodSync(artifact.directory, 0o500);
  const folder = path.join(artifact.directory, members[0].migration_name); const file = path.join(folder, "migration.sql");
  fs.chmodSync(folder, 0o700); const saved = path.join(root, "saved.sql"); fs.renameSync(file, saved);
  fs.chmodSync(folder, 0o500); assert.throws(() => fence.verify(artifact));
  fs.chmodSync(folder, 0o700); fs.symlinkSync(saved, file); fs.chmodSync(folder, 0o500); assert.throws(() => fence.verify(artifact));
  fs.chmodSync(folder, 0o700); fs.unlinkSync(file); fs.linkSync(saved, file); fs.chmodSync(folder, 0o500); assert.throws(() => fence.verify(artifact));
  fs.chmodSync(folder, 0o700); fs.unlinkSync(file); fs.renameSync(saved, file); fs.chmodSync(folder, 0o500);
  assert.equal(fence.verify(artifact), artifact);
});

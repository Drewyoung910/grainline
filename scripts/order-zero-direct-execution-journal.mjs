// Migration intent contains no credentials or database rows. Files and locks
// survive failure; only a completely accepted attempt releases its lock.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const FAILURE = "Order execution journal stopped; preserve attempt for inspection";
const STAGES = ["prepared", "apply-intent", "prefix-verified", "grant-intent", "grants-verified", "status-verified", "audit-verified", "complete"];
// APFS directory link counts change when ordinary entries are added. File
// single-link ownership is checked separately by privateRead.
const same = (a, b) => ["dev", "ino", "mode", "uid"].every(key => a[key] === b[key]);

export function createOrderExecutionJournal({ directory, binding }) {
  let directoryFd, closed = false, poisoned = false, last, lockStat;
  const nonce = randomUUID();
  const lock = path.join(directory, "execution.lock"), state = path.join(directory, "execution.json"), pending = path.join(directory, "execution.pending");
  const error = () => new Error(FAILURE);
  function privateRead(file) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const before = fs.fstatSync(fd);
      assert.ok(before.isFile() && before.nlink === 1 && before.uid === process.getuid()
        && (before.mode & 0o7777) === 0o600 && before.size <= 16384);
      const bytes = fs.readFileSync(fd, "utf8");
      const after = fs.fstatSync(fd);
      assert.ok(same(before, after) && same(before, fs.lstatSync(file)) && before.size === after.size && before.mtimeMs === after.mtimeMs);
      return bytes;
    } finally { fs.closeSync(fd); }
  }
  function writeNew(file, contents) {
    assert.ok(Buffer.byteLength(contents) <= 16384);
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, contents); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    assert.equal(privateRead(file), contents);
  }
  let original;
  function check() {
    assert.ok(!closed && !poisoned);
    assert.equal(fs.realpathSync(directory), directory);
    assert.ok(same(original, fs.lstatSync(directory)) && same(original, fs.fstatSync(directoryFd)));
    assert.ok(same(lockStat, fs.lstatSync(lock)));
    assert.equal(privateRead(lock), nonce);
    assert.ok(!fs.existsSync(pending));
    if (last) assert.equal(privateRead(state), JSON.stringify(last) + "\n");
    else assert.ok(!fs.existsSync(state));
  }
  try {
    assert.deepEqual(Object.keys(binding).sort(), ["initialPrefix", "prefixCatalogSha256", "releaseCommit", "sourceCatalogSha256"]);
    assert.match(binding.releaseCommit, /^[a-f0-9]{40}$/u);
    for (const key of ["prefixCatalogSha256", "sourceCatalogSha256"]) assert.match(binding[key], /^[a-f0-9]{64}$/u);
    assert.ok(Number.isInteger(binding.initialPrefix) && binding.initialPrefix >= 0 && binding.initialPrefix <= 17);
    binding = Object.freeze(structuredClone(binding));
    assert.equal(path.resolve(directory), directory); assert.equal(fs.realpathSync(directory), directory);
    original = fs.lstatSync(directory);
    assert.ok(original.isDirectory() && original.uid === process.getuid() && (original.mode & 0o7777) === 0o700);
    directoryFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    // A prior state/lock/pending entry, even a completed one, cannot silently
    // become authority for this new attempt. Use a new reviewed attempt.
    assert.deepEqual(fs.readdirSync(directory), []);
    writeNew(lock, nonce); lockStat = fs.lstatSync(lock); fs.fsyncSync(directoryFd);
    // The attempt directory itself is new: persist its parent entry as well.
    const parentFd = fs.openSync(path.dirname(directory), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(parentFd); } finally { fs.closeSync(parentFd); }
    check();
  } catch { if (directoryFd !== undefined) fs.closeSync(directoryFd); throw error(); }

  function guard(fn) {
    try { check(); return fn(); } catch { poisoned = true; throw error(); }
  }
  return Object.freeze({
    verify: () => guard(() => last ? Object.freeze({ ...last }) : null),
    advance: stage => guard(() => {
      const nextIndex = STAGES.indexOf(stage), oldIndex = last ? STAGES.indexOf(last.stage) : -1;
      assert.ok(nextIndex === oldIndex + 1 || (binding.initialPrefix === 17 && last?.stage === "prepared" && stage === "prefix-verified"));
      const next = Object.freeze({ version: 1, attemptId: nonce, ...binding, stage, productionExecutionAuthorized: false });
      const contents = JSON.stringify(next) + "\n";
      writeNew(pending, contents);
      // Recheck directory and previous state before replacing precisely our file.
      assert.ok(same(original, fs.lstatSync(directory)) && same(lockStat, fs.lstatSync(lock)));
      assert.equal(privateRead(lock), nonce);
      if (last) assert.equal(privateRead(state), JSON.stringify(last) + "\n");
      else assert.ok(!fs.existsSync(state));
      fs.renameSync(pending, state); fs.fsyncSync(directoryFd);
      assert.equal(privateRead(state), contents); last = next;
      return Object.freeze({ ...next });
    }),
    close: () => {
      if (closed) return;
      try {
        if (!poisoned && last?.stage === "complete") {
          check(); fs.unlinkSync(lock); fs.fsyncSync(directoryFd);
        }
      } catch { poisoned = true; throw error(); }
      finally { closed = true; fs.closeSync(directoryFd); }
    },
  });
}

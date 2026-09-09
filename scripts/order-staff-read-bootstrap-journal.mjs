// Dormant local adapter: no production path, environment reader or entrypoint.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateStaffBootstrapState } from "./order-staff-read-role-bootstrap.mjs";

export const STAFF_JOURNAL_FILES = Object.freeze({
  state: "staff-bootstrap.json", pending: "staff-bootstrap.pending", lock: "staff-bootstrap.lock",
});
const STAGES = ["prepared", "create-pending", "role-verified"];
const fail = () => new Error("staff bootstrap private journal stopped; preserve files for exact-attempt recovery");
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

function privateFile(stat) {
  assert.ok(stat.isFile() && stat.uid === process.getuid() &&
    (stat.mode & 0o7777) === 0o600 && stat.nlink === 1 && stat.size <= 8192);
}

function readPrivate(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    privateFile(stat);
    assert.ok(sameFile(stat, fs.lstatSync(file)));
    return fs.readFileSync(fd, "utf8");
  } finally { fs.closeSync(fd); }
}

function exists(file) {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

function createPrivate(file, contents) {
  const fd = fs.openSync(file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    privateFile(fs.fstatSync(fd));
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

// Callers supply an ALREADY CREATED canonical, owner-only directory. The future
// release operator must pin its fixed ignored location. Tests use disposable dirs.
// A stale lock or pending file is never removed/adopted automatically.
export async function withStaffBootstrapJournal({ directory, binding }, callback) {
  let directoryFd;
  let ownedLock;
  let lockPath;
  let verifyDirectory;
  try {
    assert.ok(typeof directory === "string" && path.isAbsolute(directory) &&
      directory === path.resolve(directory) && fs.realpathSync(directory) === directory);
    const originalDirectory = fs.lstatSync(directory);
    assert.ok(originalDirectory.isDirectory() && originalDirectory.uid === process.getuid() &&
      (originalDirectory.mode & 0o7777) === 0o700);
    directoryFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    verifyDirectory = () => {
      const current = fs.lstatSync(directory);
      assert.ok(sameFile(originalDirectory, current) && sameFile(current, fs.fstatSync(directoryFd)) &&
        current.uid === process.getuid() && (current.mode & 0o7777) === 0o700 &&
        fs.realpathSync(directory) === directory);
    };
    verifyDirectory();
    const statePath = path.join(directory, STAFF_JOURNAL_FILES.state);
    const pendingPath = path.join(directory, STAFF_JOURNAL_FILES.pending);
    lockPath = path.join(directory, STAFF_JOURNAL_FILES.lock);
    const lockContents = JSON.stringify({ version: 1, nonce: randomUUID(), pid: process.pid });
    // Assign ownership only after exclusive creation and durable readback.
    createPrivate(lockPath, lockContents);
    ownedLock = { stat: fs.lstatSync(lockPath), contents: lockContents };
    fs.fsyncSync(directoryFd);
    let active = true;
    let poisoned = false;
    const check = () => {
      assert.ok(active && !poisoned);
      verifyDirectory();
      assert.ok(sameFile(ownedLock.stat, fs.lstatSync(lockPath)) && readPrivate(lockPath) === lockContents);
      assert.ok(!exists(pendingPath));
    };
    const read = () => {
      check();
      return exists(statePath)
        ? validateStaffBootstrapState(JSON.parse(readPrivate(statePath)), binding) : null;
    };
    let last = read();
    const guarded = (fn) => (...args) => {
      try { return fn(...args); }
      catch { poisoned = true; throw fail(); }
    };
    const journal = Object.freeze({
      read: guarded(() => {
        const disk = read();
        assert.ok(JSON.stringify(disk) === JSON.stringify(last));
        return disk;
      }),
      persistPrivateState: guarded((rawState) => {
        const next = validateStaffBootstrapState(rawState, binding);
        const current = read();
        assert.ok(JSON.stringify(current) === JSON.stringify(last));
        if (current) {
          // Identity/secret is immutable; only same-stage or one-step progress.
          assert.ok(JSON.stringify({ ...current, stage: next.stage }) === JSON.stringify(next));
          const delta = STAGES.indexOf(next.stage) - STAGES.indexOf(current.stage);
          assert.ok(delta === 0 || delta === 1);
        } else assert.ok(next.stage === "prepared");
        const contents = JSON.stringify(next) + "\n";
        createPrivate(pendingPath, contents);
        assert.ok(readPrivate(pendingPath) === contents);
        verifyDirectory();
        // Under the exclusive lock, replace only the state just read above.
        assert.ok((current === null && !exists(statePath)) ||
          (current !== null && JSON.stringify(validateStaffBootstrapState(JSON.parse(readPrivate(statePath)), binding)) === JSON.stringify(current)));
        fs.renameSync(pendingPath, statePath);
        fs.fsyncSync(directoryFd);
        assert.ok(readPrivate(statePath) === contents);
        last = next;
      }),
    });
    try { return await callback(journal); }
    finally { active = false; }
  } catch { throw fail(); }
  finally {
    try {
      if (ownedLock) {
        verifyDirectory();
        assert.ok(sameFile(ownedLock.stat, fs.lstatSync(lockPath)) && readPrivate(lockPath) === ownedLock.contents);
        fs.unlinkSync(lockPath);
        fs.fsyncSync(directoryFd);
      }
    } catch { throw fail(); }
    finally { if (directoryFd !== undefined) fs.closeSync(directoryFd); }
  }
}

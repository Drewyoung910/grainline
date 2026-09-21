import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readSync,
  realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const FAIL = "R2 GitHub dispatch journal refused; preserve the directory for recovery.";
const check = value => { if (!value) throw new Error(FAIL); };
const same = (a, b) => ["dev", "ino", "uid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"].every(key => a[key] === b[key]);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const NAMES = ["intent", "acknowledgement", "receipt"];

// Immutable records, never overwrite or repair. A partially written file or a
// crash-retained lock refuses recovery instead of making another POST possible.
export async function withR2GitHubDispatchJournal(directory, callback) {
  let directoryFd, lock, lockStat;
  const observed = new Map();
  try {
    check(typeof callback === "function" && typeof directory === "string" && isAbsolute(directory) && realpathSync(directory) === directory);
    const ds = lstatSync(directory, { bigint: true });
    check(ds.isDirectory() && ds.uid === BigInt(process.getuid()) && (ds.mode & 0o777n) === 0o700n);
    directoryFd = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    const lockPath = join(directory, "dispatch.lock");
    const guard = () => {
      const current = lstatSync(directory, { bigint: true });
      check(current.dev === ds.dev && current.ino === ds.ino && current.uid === ds.uid && current.mode === ds.mode
        && realpathSync(directory) === directory);
      check(fstatSync(directoryFd, { bigint: true }).ino === ds.ino);
      if (lockStat) check(same(lockStat, fstatSync(lock, { bigint: true })) && same(lockStat, lstatSync(lockPath, { bigint: true })));
    };
    guard();
    lock = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(lock, JSON.stringify({ pid: process.pid, id: randomUUID() }) + "\n"); fsyncSync(lock);
    lockStat = fstatSync(lock, { bigint: true }); fsyncSync(directoryFd);
    const read = name => {
      check(NAMES.includes(name)); guard(); const filename = join(directory, name + ".json");
      let before;
      try { before = lstatSync(filename, { bigint: true }); }
      catch (error) { check(error.code === "ENOENT" && !observed.has(name)); return null; }
      check(before.isFile() && before.uid === ds.uid && (before.mode & 0o777n) === 0o600n
        && before.nlink === 1n && before.size > 0n && before.size <= 16384n);
      const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        check(same(before, fstatSync(fd, { bigint: true })));
        const bytes = Buffer.alloc(Number(before.size) + 1); let offset = 0;
        while (offset < bytes.length) {
          const length = readSync(fd, bytes, offset, bytes.length - offset, offset); if (!length) break; offset += length;
        }
        check(BigInt(offset) === before.size && same(before, fstatSync(fd, { bigint: true })) && same(before, lstatSync(filename, { bigint: true })));
        const data = bytes.subarray(0, offset), digest = hash(data), previous = observed.get(name);
        check(!previous || previous.digest === digest && same(previous.stat, before));
        const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
        observed.set(name, { digest, stat: before }); guard(); return value;
      } finally { closeSync(fd); }
    };
    const journal = Object.freeze({ read, write(name, value) {
      check(NAMES.includes(name) && read(name) === null); guard();
      const bytes = Buffer.from(JSON.stringify(value) + "\n"); check(bytes.length <= 16384);
      const fd = openSync(join(directory, name + ".json"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      fsyncSync(directoryFd); check(hash(Buffer.from(JSON.stringify(read(name)) + "\n")) === hash(bytes));
    } });
    NAMES.forEach(read);
    const result = await callback(journal); guard(); NAMES.forEach(read); return result;
  } catch { throw new Error(FAIL); }
  finally {
    if (lock !== undefined) {
      try {
        const lockPath = join(directory, "dispatch.lock");
        if (lockStat && same(lockStat, lstatSync(lockPath, { bigint: true }))) { unlinkSync(lockPath); fsyncSync(directoryFd); }
      } finally { closeSync(lock); }
    }
    if (directoryFd !== undefined) closeSync(directoryFd);
  }
}

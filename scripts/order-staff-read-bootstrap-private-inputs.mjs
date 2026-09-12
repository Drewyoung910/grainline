// Dormant, read-only private loaders. No CLI, environment fallback, file writes,
// credential rotation, network access or secret installation.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
import { assertStaffBootstrapReviewedBinding } from "./order-staff-read-bootstrap-release.mjs";
import { staffBootstrapConnectionConfig } from "./order-staff-read-bootstrap-connection.mjs";
import { assertVercelRuntimeDatabaseIsolation } from "./guard-runtime-db-env.mjs";

export const STAFF_BOOTSTRAP_PRIVATE_ROOT = "/Users/drewyoung/grainline";
export const STAFF_BOOTSTRAP_EPOCH_FILE = "/Users/drewyoung/grainline-rollout-evidence/database-credential-recovery-20260902.json";
export const STAFF_BOOTSTRAP_AUTHORITY = "create-and-verify-authority-free-login-only";
const INPUT_DIRECTORY = ".env.order-staff-bootstrap";
const MAX_BYTES = 128 * 1024;
const DIGEST = /^[0-9a-f]{64}$/u;
const sha256 = value => createHash("sha256").update(value).digest("hex");
const failed = () => new Error("staff bootstrap private inputs invalid or changed; preserve private files");
const exactKeys = (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

function readPrivate(file, limit = MAX_BYTES) {
  let fd;
  try {
    assert.ok(path.isAbsolute(file) && path.resolve(file) === file && fs.realpathSync(file) === file);
    const parent = fs.lstatSync(path.dirname(file));
    assert.ok(parent.isDirectory() && parent.uid === process.getuid() && (parent.mode & 0o022) === 0);
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd);
    const valid = stat => assert.ok(stat.isFile() && stat.uid === process.getuid() && stat.nlink === 1 &&
      (stat.mode & 0o7777) === 0o600 && stat.size > 0 && stat.size <= limit);
    valid(before);
    assert.ok(sameFile(before, fs.lstatSync(file)));
    // Do not let growth after fstat turn readFile into an unbounded allocation.
    const buffer = Buffer.alloc(limit + 1);
    let size = 0, count;
    do { count = fs.readSync(fd, buffer, size, buffer.length - size, null); size += count; } while (count && size < buffer.length);
    const after = fs.fstatSync(fd);
    valid(after);
    assert.ok(size === before.size && sameFile(before, after) && sameFile(after, fs.lstatSync(file)) && fs.realpathSync(file) === file);
    return buffer.subarray(0, size);
  } catch { throw failed(); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function canonicalJson(bytes) {
  const value = JSON.parse(bytes.toString("utf8"));
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  // The manifest/token preparer writes this format. Reject duplicate JSON keys
  // and ambiguous reserializations, not just the parser's last-key-wins result.
  assert.equal(bytes.toString("utf8"), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

function verifyPrivateLocation(root) {
  assert.ok(path.isAbsolute(root) && path.resolve(root) === root && fs.realpathSync(root) === root);
  const rootStat = fs.lstatSync(root);
  assert.ok(rootStat.isDirectory() && rootStat.uid === process.getuid() && (rootStat.mode & 0o022) === 0);
  const directory = path.join(root, INPUT_DIRECTORY);
  const stat = fs.lstatSync(directory);
  assert.ok(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o7777) === 0o700 && fs.realpathSync(directory) === directory);
  const git = (args, input) => execFileSync("/usr/bin/git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: root, encoding: "utf8", input, timeout: 10000, maxBuffer: MAX_BYTES,
    stdio: ["pipe", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" },
  });
  assert.equal(fs.realpathSync(git(["rev-parse", "--show-toplevel"]).trim()), root);
  // An ignored parent is pruned by Git, including newly generated journal files.
  // Separately reject any already tracked child, even one covered by ignore rules.
  const names = [INPUT_DIRECTORY, ".env.migration-owner.local", ".env.local"];
  assert.deepEqual(git(["check-ignore", "--no-index", "-z", "--stdin"], names.join("\0") + "\0")
    .split("\0").filter(Boolean), names);
  assert.equal(git(["ls-files", "-z", "--", ...names]), "");
  return directory;
}

// Explicit-path seam for disposable filesystem tests. The production wrapper
// below exposes ONLY the externally approved manifest digest, never path overrides.
export function staffBootstrapPrivateInputOperations({ root, evidencePath, manifestSha256 }) {
  try {
    assert.ok(typeof manifestSha256 === "string" && DIGEST.test(manifestSha256));
    const directory = verifyPrivateLocation(root);
    const manifestPath = path.join(directory, "release.json");
    const readManifest = () => {
      assert.equal(verifyPrivateLocation(root), directory);
      const bytes = readPrivate(manifestPath, 16384);
      assert.equal(sha256(bytes), manifestSha256);
      const manifest = canonicalJson(bytes);
      exactKeys(manifest, ["schemaVersion", "operation", "authority", "reviewed"]);
      assert.ok(manifest.schemaVersion === 1 && manifest.operation === "order-staff-read-bootstrap" &&
        manifest.authority === STAFF_BOOTSTRAP_AUTHORITY);
      return assertStaffBootstrapReviewedBinding(manifest.reviewed);
    };
    const reviewed = readManifest();
    const guard = operation => () => {
      try { readManifest(); const result = operation(); readManifest(); return result; }
      catch { throw failed(); }
    };
    const credentialSnapshot = () => {
      const bytes = readPrivate(evidencePath);
      assert.equal(sha256(bytes), reviewed.credentialEpochSha256);
      const evidence = canonicalJson(bytes);
      assert.ok(evidence.schemaVersion === 1 && evidence.operation === "database-credential-exposure-recovery" &&
        evidence.status === "passed" && evidence.acceptanceEligible === true && evidence.issueCount === 0 &&
        evidence.grantAudit?.readOnly === true && evidence.grantAudit.issueCount === 0 &&
        evidence.providerScopeOutsideRecoveryChanged === false && Array.isArray(evidence.migrationsApplied) && evidence.migrationsApplied.length === 0);
      const ownerSource = readPrivate(path.join(root, ".env.migration-owner.local")).toString("utf8");
      const ownerMatch = /^DIRECT_URL="([^"\r\n]+)"\r?\n?$/u.exec(ownerSource);
      assert.ok(ownerMatch);
      const ownerUrl = ownerMatch[1];
      staffBootstrapConnectionConfig(ownerUrl, "neondb_owner", {}); // Pure URL validation; no connection.
      const runtimeSource = readPrivate(path.join(root, ".env.local")).toString("utf8");
      assert.equal(runtimeSource.split(/\r?\n/u).filter(line => /^\s*(?:export\s+)?DATABASE_URL\s*(?:=|:\s)/u.test(line)).length, 1);
      const runtimeUrl = dotenv.parse(runtimeSource).DATABASE_URL;
      assertVercelRuntimeDatabaseIsolation({ VERCEL: "1", VERCEL_ENV: "production",
        RUNTIME_DB_ROLE: "grainline_app_runtime", DATABASE_URL: runtimeUrl });
      for (const [kind, role, url] of [["owner", "neondb_owner", ownerUrl], ["runtime", "grainline_app_runtime", runtimeUrl]]) {
        const proof = evidence.credentials?.[kind];
        assert.ok(proof?.role === role && proof.priorRejected === true && proof.replacementVerified === true &&
          typeof proof.priorSha256 === "string" && DIGEST.test(proof.priorSha256) &&
          proof.replacementSha256 === sha256(url) && proof.priorSha256 !== proof.replacementSha256);
      }
      return { ownerUrl, epochSha256: reviewed.credentialEpochSha256 };
    };
    return Object.freeze({ reviewed, directory, manifestSha256,
      verifyManifest: guard(() => true),
      loadProviderTokens: guard(() => {
        const tokens = canonicalJson(readPrivate(path.join(directory, "provider-tokens.json"), 16384));
        exactKeys(tokens, ["github", "vercel"]);
        assert.ok(Object.values(tokens).every(token => typeof token === "string" && /^[\x21-\x7e]{8,4096}$/u.test(token)));
        return Object.freeze({ github: tokens.github, vercel: tokens.vercel });
      }),
      loadOwnerCredential: guard(() => {
        const snapshot = credentialSnapshot();
        return Object.freeze({ url: snapshot.ownerUrl, epochSha256: snapshot.epochSha256 });
      }),
      observeCredentialEpoch: guard(() => {
        credentialSnapshot();
        return Object.freeze({ evidenceSha256: reviewed.credentialEpochSha256, status: "complete", localCredentialsMatch: true });
      }),
    });
  } catch { throw failed(); }
}

export function createStaffBootstrapPrivateInputs(options) {
  try {
    exactKeys(options, ["manifestSha256"]);
    return staffBootstrapPrivateInputOperations({ root: STAFF_BOOTSTRAP_PRIVATE_ROOT,
      evidencePath: STAFF_BOOTSTRAP_EPOCH_FILE, manifestSha256: options.manifestSha256 });
  } catch { throw failed(); }
}

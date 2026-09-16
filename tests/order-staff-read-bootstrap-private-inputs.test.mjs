import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { staffBootstrapPrivateInputOperations, createStaffBootstrapPrivateInputs } from "../scripts/order-staff-read-bootstrap-private-inputs.mjs";
import { coordinateStaffBootstrap } from "../scripts/order-staff-read-bootstrap-coordinator.mjs";
import { STAFF_BOOTSTRAP_ROLE, staffBootstrapMarker } from "../scripts/order-staff-read-role-bootstrap.mjs";
import { STAFF_JOURNAL_FILES } from "../scripts/order-staff-read-bootstrap-journal.mjs";
import { staffReleaseFixture } from "./helpers/staff-bootstrap-release-fixture.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const ownerUrl = "postgresql://neondb_owner:fixture-owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const runtimeUrl = "postgresql://grainline_app_runtime:fixture-runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grainline-staff-private-test-")));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "repo"); fs.mkdirSync(root, { mode: 0o700 });
  const directory = path.join(root, ".env.order-staff-bootstrap"); fs.mkdirSync(directory, { mode: 0o700 });
  const git = args => execFileSync("/usr/bin/git", args, { cwd: root, stdio: "pipe",
    env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  git(["init", "-q"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".env*\n");
  const evidencePath = path.join(base, "epoch.json");
  const evidence = { schemaVersion: 1, operation: "database-credential-exposure-recovery", status: "passed",
    acceptanceEligible: true, issueCount: 0, grantAudit: { readOnly: true, issueCount: 0 },
    providerScopeOutsideRecoveryChanged: false, migrationsApplied: [], credentials: {
      owner: { role: "neondb_owner", priorSha256: "1".repeat(64), replacementSha256: hash(ownerUrl), priorRejected: true, replacementVerified: true },
      runtime: { role: "grainline_app_runtime", priorSha256: "2".repeat(64), replacementSha256: hash(runtimeUrl), priorRejected: true, replacementVerified: true },
    } };
  const release = staffReleaseFixture();
  release.reviewed.credentialEpochSha256 = hash(json(evidence));
  const manifest = { schemaVersion: 1, operation: "order-staff-read-bootstrap",
    authority: "create-and-verify-authority-free-login-only", reviewed: release.reviewed };
  const files = { manifest: path.join(directory, "release.json"), tokens: path.join(directory, "provider-tokens.json"),
    owner: path.join(root, ".env.migration-owner.local"), runtime: path.join(root, ".env.local"), evidence: evidencePath };
  const put = (file, contents) => fs.writeFileSync(file, contents, { mode: 0o600 });
  put(files.manifest, json(manifest)); put(files.evidence, json(evidence));
  put(files.tokens, json({ github: "fixture-github-token", vercel: "fixture-vercel-token" }));
  put(files.owner, `DIRECT_URL="${ownerUrl}"\n`);
  put(files.runtime, `# Existing unrelated settings remain private.\nDATABASE_URL="${runtimeUrl}"\nUNRELATED_SECRET=never-return-this\n`);
  const options = { root, evidencePath, manifestSha256: hash(json(manifest)) };
  return { base, root, directory, git, evidence, release, manifest, files, put, options,
    load: () => staffBootstrapPrivateInputOperations(options) };
}

test("fixed private loaders read reviewed files without writes, exposing only narrowly needed values", t => {
  const f = fixture(t); const before = Object.values(f.files).map(file => fs.readFileSync(file));
  const inputs = f.load();
  assert.ok(Object.isFrozen(inputs) && Object.isFrozen(inputs.reviewed));
  assert.equal(inputs.directory, f.directory);
  assert.equal(inputs.verifyManifest(), true);
  assert.deepEqual(inputs.loadProviderTokens(), { github: "fixture-github-token", vercel: "fixture-vercel-token" });
  assert.deepEqual(inputs.loadOwnerCredential(), { url: ownerUrl, epochSha256: f.release.reviewed.credentialEpochSha256 });
  const epoch = inputs.observeCredentialEpoch();
  assert.deepEqual(epoch, { status: "complete", evidenceSha256: f.release.reviewed.credentialEpochSha256, localCredentialsMatch: true });
  assert.doesNotMatch(JSON.stringify(epoch), /fixture-owner|fixture-runtime|never-return/u);
  assert.deepEqual(Object.values(f.files).map(file => fs.readFileSync(file)), before);
});

test("manifest digest, schema, scope, duplicate keys and path overrides fail closed", t => {
  for (const kind of ["digest", "scope", "key", "duplicate", "format"]) {
    const f = fixture(t);
    if (kind === "digest") f.options.manifestSha256 = "0".repeat(64);
    else {
      let source;
      if (kind === "scope") f.manifest.authority = "grant-and-deploy";
      if (kind === "key") f.manifest.reviewed.unreviewed = true;
      source = json(f.manifest);
      if (kind === "duplicate") source = source.replace('"schemaVersion": 1,', '"schemaVersion": 2,\n  "schemaVersion": 1,');
      if (kind === "format") source = JSON.stringify(f.manifest);
      f.put(f.files.manifest, source); f.options.manifestSha256 = hash(source);
    }
    assert.throws(f.load, /private inputs invalid/u);
  }
  // Unknown options are rejected before the production wrapper touches a path.
  assert.throws(() => createStaffBootstrapPrivateInputs({ manifestSha256: "a".repeat(64), root: "/override" }), /private inputs invalid/u);
});

test("Git must ignore the entire private directory and no private file may already be tracked", t => {
  for (const kind of ["unignored-parent", "tracked-token", "tracked-owner", "per-file-only"]) {
    const f = fixture(t);
    if (kind === "unignored-parent") fs.writeFileSync(path.join(f.root, ".gitignore"), ".env*\n!.env.order-staff-bootstrap/\n");
    if (kind === "per-file-only") fs.writeFileSync(path.join(f.root, ".gitignore"), ".env.local\n.env.migration-owner.local\n.env.order-staff-bootstrap/*\n");
    if (kind === "tracked-token") f.git(["add", "-f", f.files.tokens]);
    if (kind === "tracked-owner") f.git(["add", "-f", f.files.owner]);
    assert.throws(f.load, /private inputs invalid/u);
  }
});

test("unsafe permissions, links, special files and oversized files never load credentials", t => {
  for (const kind of ["directory-mode", "file-mode", "hardlink", "symlink", "directory-file", "oversized", "root-writeable"]) {
    const f = fixture(t);
    if (kind === "directory-mode") fs.chmodSync(f.directory, 0o755);
    if (kind === "root-writeable") fs.chmodSync(f.root, 0o777);
    if (kind === "file-mode") fs.chmodSync(f.files.manifest, 0o644);
    if (kind === "hardlink") fs.linkSync(f.files.manifest, path.join(f.base, "linked"));
    if (kind === "symlink") { fs.renameSync(f.files.manifest, path.join(f.base, "target")); fs.symlinkSync(path.join(f.base, "target"), f.files.manifest); }
    if (kind === "directory-file") { fs.unlinkSync(f.files.manifest); fs.mkdirSync(f.files.manifest); }
    if (kind === "oversized") f.put(f.files.manifest, "x".repeat(16385));
    assert.throws(f.load, /private inputs invalid/u);
  }
  const f = fixture(t); const inputs = f.load();
  fs.chmodSync(f.files.owner, 0o644);
  assert.throws(inputs.loadOwnerCredential, /private inputs invalid/u);
});

test("every later read revalidates the manifest and ignored location", t => {
  for (const kind of ["manifest", "gitignore", "directory"]) {
    const f = fixture(t); const inputs = f.load();
    if (kind === "manifest") f.put(f.files.manifest, "PRIVATE_SENTINEL");
    if (kind === "gitignore") fs.writeFileSync(path.join(f.root, ".gitignore"), "");
    if (kind === "directory") fs.chmodSync(f.directory, 0o755);
    for (const read of [inputs.verifyManifest, inputs.loadProviderTokens, inputs.loadOwnerCredential, inputs.observeCredentialEpoch]) {
      assert.throws(read, error => error.message === "staff bootstrap private inputs invalid or changed; preserve private files" && !error.cause);
    }
  }
});

test("credential epoch binds actual local owner/runtime URLs and rejects malformed or duplicated assignments", t => {
  for (const kind of ["owner", "runtime", "duplicate", "export-duplicate", "colon-duplicate", "evidence", "token-scope"]) {
    const f = fixture(t); const inputs = f.load();
    if (kind === "owner") f.put(f.files.owner, `DIRECT_URL="${ownerUrl.replace("fixture-owner", "changed")}"\n`);
    if (kind === "runtime") f.put(f.files.runtime, `DATABASE_URL="${runtimeUrl.replace("fixture-runtime", "changed")}"\n`);
    if (kind === "duplicate") f.put(f.files.runtime, `DATABASE_URL="${runtimeUrl}"\n DATABASE_URL="${runtimeUrl}"\n`);
    if (kind === "export-duplicate") f.put(f.files.runtime, `DATABASE_URL="${runtimeUrl}"\nexport DATABASE_URL="${runtimeUrl}"\n`);
    if (kind === "colon-duplicate") f.put(f.files.runtime, `DATABASE_URL="${runtimeUrl}"\nDATABASE_URL: ${runtimeUrl}\n`);
    if (kind === "evidence") f.put(f.files.evidence, json({ ...f.evidence, status: "failed" }));
    if (kind === "token-scope") f.put(f.files.tokens, json({ github: "fixture-token", vercel: "fixture-token", stripe: "PRIVATE_SENTINEL" }));
    assert.throws(kind === "token-scope" ? inputs.loadProviderTokens : inputs.observeCredentialEpoch, /private inputs invalid/u);
  }
});

test("even a pinned epoch needs accepted role/denial evidence and safe endpoint shapes", t => {
  for (const kind of ["accepted", "role", "prior-rejection", "same-password", "owner-endpoint"]) {
    const f = fixture(t);
    if (kind === "accepted") f.evidence.acceptanceEligible = false;
    if (kind === "role") f.evidence.credentials.owner.role = "other";
    if (kind === "prior-rejection") f.evidence.credentials.runtime.priorRejected = false;
    if (kind === "same-password") f.evidence.credentials.owner.priorSha256 = hash(ownerUrl);
    if (kind === "owner-endpoint") {
      const wrong = ownerUrl.replace("ep-plain-river-aaqg8gj4", "ep-other");
      f.put(f.files.owner, `DIRECT_URL="${wrong}"\n`); f.evidence.credentials.owner.replacementSha256 = hash(wrong);
    }
    f.put(f.files.evidence, json(f.evidence));
    f.manifest.reviewed.credentialEpochSha256 = hash(json(f.evidence));
    f.put(f.files.manifest, json(f.manifest)); f.options.manifestSha256 = hash(json(f.manifest));
    assert.throws(f.load().observeCredentialEpoch, /private inputs invalid/u);
  }
});

test("coordinator reads private epoch only under its lock and refuses a competing reader", async t => {
  const f = fixture(t); const inputs = f.load(); let observers = 0, ownerCalls = 0, competing = false;
  const options = { reviewed: inputs.reviewed, directory: inputs.directory, env: {},
    observeRelease: async () => {
      observers++;
      assert.ok(fs.existsSync(path.join(f.directory, STAFF_JOURNAL_FILES.lock)));
      return { ...f.release, credentialEpoch: inputs.observeCredentialEpoch() };
    },
    loadOwnerCredential: inputs.loadOwnerCredential,
    connectionFactory: ({ state }) => ({
      async executeOwnerTransaction() {
        ownerCalls++;
        if (!competing) {
          competing = true; const count = observers;
          await assert.rejects(coordinateStaffBootstrap(options), /private-journal/u);
          assert.equal(observers, count);
        }
      },
      async proveSeparateLogin() { return { currentUser: STAFF_BOOTSTRAP_ROLE, sessionUser: STAFF_BOOTSTRAP_ROLE,
        database: "neondb", marker: staffBootstrapMarker(state), restrictedRole: true, hasApplicationAuthority: false }; },
    }),
  };
  assert.equal((await coordinateStaffBootstrap(options)).status, "role-verified");
  assert.equal(observers, 4); assert.equal(ownerCalls, 1);
  assert.equal((await coordinateStaffBootstrap(options)).status, "role-verified");
  assert.equal(ownerCalls, 1);
});

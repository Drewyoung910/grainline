import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const scriptPath = "scripts/stage-notification-rls-candidate-migration.mjs";
const source = fs.readFileSync(scriptPath, "utf8");
const candidateDirectory = "prisma/migrations/20260722051500_enable_notification_rls";

describe("Notification disposable candidate migration", () => {
  it("byte-pins every reviewed draft without writing in verify mode", () => {
    assert.equal(fs.existsSync(candidateDirectory), false);
    const result = JSON.parse(execFileSync(process.execPath, [scriptPath, "--verify"], {
      encoding: "utf8",
    }));
    assert.equal(result.mode, "--verify");
    assert.equal(result.staged, false);
    assert.equal(result.migrationName, "20260722051500_enable_notification_rls");
    assert.equal(
      result.candidateSha256,
      "54580769d888671e6a18a3a87fa57849e66c2d50d416f8a254400d0482a299de",
    );
    assert.deepEqual(result.sources, [
      {
        path: "docs/rls-drafts/notification-related-user.sql",
        sha256: "d8a394e3e586a2f51c006a69415bdf04326ce3affc6f42dba2186c255325e058",
      },
      {
        path: "docs/rls-drafts/notification-recipient-access.sql",
        sha256: "8b59ef1d6164be6c48330c0c2c0560f1d5c401b7aa000fa094b3a390c00f14f8",
      },
      {
        path: "docs/rls-drafts/notification-service-authority.sql",
        sha256: "03ec2b5c6b7babc1c67e8e86e9505d23747242b51433e1bf8e49cc62424dbe2f",
      },
    ]);
    assert.equal(fs.existsSync(candidateDirectory), false);
  });

  it("requires an exact loopback-only staging acknowledgement", () => {
    const result = spawnSync(process.execPath, [scriptPath, "--stage"], {
      encoding: "utf8",
      env: {
        ...process.env,
        NOTIFICATION_RLS_DISPOSABLE_MIGRATION_ACK: "",
        DIRECT_URL: "postgresql://owner:secret@production.invalid/grainline",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /disposable Notification migration acknowledgement is missing/);
    assert.equal(fs.existsSync(candidateDirectory), false);
  });

  it("wraps lock, purge, drafts, and postflight in one migration transaction", () => {
    assert.match(source, /candidate migration must have one outer transaction/);
    assert.match(source, /pg_advisory_xact_lock/);
    assert.match(source, /LOCK TABLE public\.\\"Notification\\" IN ACCESS EXCLUSIVE MODE/);
    assert.match(source, /row_count_before/);
    assert.match(source, /GET DIAGNOSTICS deleted_count = ROW_COUNT/);
    assert.match(source, /deleted_count <> row_count_before OR row_count_after <> 0/);
    assert.match(source, /Notification must finish with ENABLE and NO FORCE/);
    assert.match(source, /Notification runtime table grants are not activation-safe/);
    assert.match(source, /candidate_function_count <> 0/);
  });

  it("keeps lifecycle DDL schema-qualified and initial activation NO FORCE", () => {
    const lifecycle = fs.readFileSync("docs/rls-drafts/notification-related-user.sql", "utf8");
    const recipient = fs.readFileSync("docs/rls-drafts/notification-recipient-access.sql", "utf8");
    assert.match(lifecycle, /ALTER TABLE public\."Notification"/);
    assert.match(lifecycle, /ON public\."Notification"\("relatedUserId"\)/);
    assert.match(recipient, /ENABLE ROW LEVEL SECURITY/);
    assert.match(recipient, /NO FORCE ROW LEVEL SECURITY/);
    assert.doesNotMatch(recipient, /(?<!NO )FORCE ROW LEVEL SECURITY/);
  });
});

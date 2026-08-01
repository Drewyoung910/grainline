import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  verifyDirectUploadRuntimeCleanupRetirement,
} from "../scripts/verify-direct-upload-runtime-cleanup-retirement.mjs";

function source(path) {
  return readFileSync(path, "utf8");
}

function fixtureRoot() {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "direct-upload-runtime-retirement-"),
  );
  for (const file of [
    "vercel.json",
    "src/lib/directUploadLifecycle.ts",
    ".github/workflows/direct-upload-cleanup.yml",
    "scripts/direct-upload-cleanup-worker.mjs",
  ]) {
    mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    cpSync(file, path.join(root, file));
  }
  return root;
}

describe("DirectUpload ordinary-runtime cleanup retirement", () => {
  it("removes every Vercel cleanup entry point without enabling GitHub scheduling", () => {
    const vercel = source("vercel.json");
    const lifecycle = source("src/lib/directUploadLifecycle.ts");
    const workflow = source(".github/workflows/direct-upload-cleanup.yml");
    const worker = source("scripts/direct-upload-cleanup-worker.mjs");

    assert.equal(
      existsSync("src/app/api/cron/direct-upload-cleanup/route.ts"),
      false,
    );
    assert.doesNotMatch(vercel, /\/api\/cron\/direct-upload-cleanup/);
    assert.doesNotMatch(lifecycle, /processExpiredDirectUploadBatch/);
    assert.doesNotMatch(lifecycle, /deleteR2ObjectByStorageClass/);
    assert.doesNotMatch(
      lifecycle,
      /grainline_direct_upload_cleanup_(?:lease|complete|fail)/,
    );

    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /^\s*schedule:/m);
    assert.match(workflow, /environment: Production DirectUpload Cleanup/);
    assert.match(worker, /grainline_direct_upload_cleanup_lease/);
    assert.match(worker, /grainline_direct_upload_cleanup_complete/);
    assert.match(worker, /grainline_direct_upload_cleanup_fail/);
    assert.match(worker, /new DeleteObjectCommand\(/);
    assert.deepEqual(verifyDirectUploadRuntimeCleanupRetirement(), {
      status: "passed",
      vercelScheduleAbsent: true,
      runtimeRouteAbsent: true,
      runtimeCleanupAuthorityAbsent: true,
      isolatedWorkerRetained: true,
      githubScheduleEnabled: false,
    });
  });

  it("fails closed if either scheduler or ordinary-runtime cleanup returns", () => {
    {
      const root = fixtureRoot();
      const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json")));
      vercel.crons.push({
        path: "/api/cron/direct-upload-cleanup",
        schedule: "50 * * * *",
      });
      writeFileSync(
        path.join(root, "vercel.json"),
        `${JSON.stringify(vercel, null, 2)}\n`,
      );
      assert.throws(
        () => verifyDirectUploadRuntimeCleanupRetirement(root),
        /Vercel DirectUpload cleanup schedule is not retired/,
      );
    }
    {
      const root = fixtureRoot();
      const lifecyclePath = path.join(root, "src/lib/directUploadLifecycle.ts");
      writeFileSync(
        lifecyclePath,
        `${readFileSync(lifecyclePath, "utf8")}\nprocessExpiredDirectUploadBatch();\n`,
      );
      assert.throws(
        () => verifyDirectUploadRuntimeCleanupRetirement(root),
        /ordinary runtime retains DirectUpload cleanup authority/,
      );
    }
    {
      const root = fixtureRoot();
      const workflowPath = path.join(
        root,
        ".github/workflows/direct-upload-cleanup.yml",
      );
      writeFileSync(
        workflowPath,
        `${readFileSync(workflowPath, "utf8")}\n  schedule:\n    - cron: "50 * * * *"\n`,
      );
      assert.throws(
        () => verifyDirectUploadRuntimeCleanupRetirement(root),
        /workflow boundary drifted/,
      );
    }
  });

  it("records the compatibility boundary and exact downstream sequence", () => {
    const release = source(
      "docs/direct-upload-runtime-cleanup-retirement-release.md",
    );
    const agentContract = source("CLAUDE.md");

    assert.match(release, /prepared on isolated branch/);
    assert.match(release, /has not been merged\s+or deployed/);
    assert.match(release, /ordinary `grainline_app_runtime` connection/);
    assert.match(release, /dpl_Gvsge8MWYW8DfDRSom34YPwsY8rH/);
    assert.match(release, /50 \* \* \* \*/);
    assert.match(release, /GitHub worker remains manual-only/);
    assert.match(release, /no schedule is added/);
    assert.match(release, /rejected Cloudflare `v3` credential is revoked/);
    assert.match(release, /Rebase and re-review draft PR #131/);
    assert.match(release, /Case evidence disabled/);
    assert.match(release, /does not merge or deploy either release/);
    assert.match(
      agentContract,
      /DirectUpload cleanup is intentionally not an `\/api\/cron\/\*` route/,
    );
    assert.match(
      agentContract,
      /ordinary-runtime `\/api\/cron\/direct-upload-cleanup` route and Vercel schedule are retired/,
    );
    assert.doesNotMatch(
      agentContract,
      /`\/api\/cron\/direct-upload-cleanup` is the hourly repair path/,
    );
    const packageJson = JSON.parse(source("package.json"));
    assert.equal(
      packageJson.scripts?.[
        "audit:rls-direct-upload-runtime-cleanup-retirement"
      ],
      "node scripts/verify-direct-upload-runtime-cleanup-retirement.mjs",
    );
  });
});

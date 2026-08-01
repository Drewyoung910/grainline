import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
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
  });

  it("records the compatibility boundary and exact downstream sequence", () => {
    const release = source(
      "docs/direct-upload-runtime-cleanup-retirement-release.md",
    );

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
  });
});

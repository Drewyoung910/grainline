import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("R2 upload smoke harness", () => {
  it("exposes the provider smoke script as an explicit npm command", () => {
    const pkg = JSON.parse(source("package.json"));

    assert.equal(
      pkg.scripts["audit:r2-upload"],
      "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/r2-upload-smoke.mjs",
    );
  });

  it("fails closed before writing objects and keeps evidence inside the repo", () => {
    const script = source("scripts/r2-upload-smoke.mjs");

    assert.match(script, /const CONFIRMATION_VALUE = "write-delete"/);
    assert.match(script, /env\.R2_UPLOAD_SMOKE_CONFIRM/);
    assert.match(script, /R2_UPLOAD_SMOKE_CONFIRM=\$\{CONFIRMATION_VALUE\} is required/);
    assert.match(script, /R2_UPLOAD_SMOKE_EVIDENCE_PATH/);
    assert.match(script, /must stay inside the repository/);
    assert.match(script, /CLOUDFLARE_R2_PUBLIC_URL must be HTTPS/);
    assert.match(script, /process\.argv\[1\] && import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
  });

  it("uses real R2 object operations for processed and direct upload evidence", () => {
    const script = source("scripts/r2-upload-smoke.mjs");

    for (const command of [
      "HeadBucketCommand",
      "PutObjectCommand",
      "HeadObjectCommand",
      "GetObjectCommand",
      "DeleteObjectCommand",
    ]) {
      assert.match(script, new RegExp(command));
    }

    assert.match(script, /sharp\(\{/);
    assert.match(script, /jpeg\(\{ quality: 90, mozjpeg: true \}\)/);
    assert.match(script, /"%PDF-1\.7/);
    assert.match(script, /ContentLength: body\.byteLength/);
    assert.match(script, /CacheControl: DEFAULT_CACHE_CONTROL/);
    assert.match(script, /uploadedObjectVerificationError/);
    assert.match(script, /uploadFileSignatureMatches\(prefixBytes, contentType\)/);
    assert.match(script, /assertPublicMediaAvailable\(publicUrl\)/);
  });

  it("probes public bucket-listing exposure without treating health as proof", () => {
    const script = source("scripts/r2-upload-smoke.mjs");
    const runbook = source("docs/runbook.md");
    const launch = source("docs/launch-checklist.md");

    assert.match(script, /public-bucket-listing-probe/);
    assert.match(script, /probePublicBucketListing/);
    assert.match(script, /<ListBucketResult\\b/);
    assert.match(script, /public R2 root appears to expose a ListBucket XML response/);
    assert.match(runbook, /npm run audit:r2-upload/);
    assert.match(runbook, /does not replace Cloudflare dashboard or CLI evidence/);
    assert.match(launch, /npm run audit:r2-upload/);
  });

  it("redacts retained evidence and records hashes instead of raw object keys", () => {
    const script = source("scripts/r2-upload-smoke.mjs");

    assert.match(script, /R2_ENV_ASSIGNMENT_PATTERN/);
    assert.match(script, /URL_USERINFO_PATTERN/);
    assert.match(script, /BEARER_PATTERN/);
    assert.match(script, /uploadTelemetryKeyHash\(key\)/);
    assert.match(script, /bucketHash: config \? uploadTelemetryKeyHash\(config\.bucket\) : null/);
    assert.match(script, /issues: issues\.slice\(0, EVIDENCE_MAX_ISSUES\)\.map\(redact\)/);
    assert.doesNotMatch(script, /publicUrl: publicUrl/);
    assert.doesNotMatch(script, /rawKey/);
  });
});

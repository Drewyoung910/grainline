import assert from "node:assert/strict";
import test from "node:test";
import { probeR2Health } from "../src/lib/r2Health.ts";
import { healthResponsePayload } from "../src/lib/healthState.ts";

test("configured public and private buckets are checked concurrently", async () => {
  const started = [], release = [];
  const pending = probeR2Health({ publicBucket: "public", privateBucket: "private", headBucket: bucket => {
    started.push(bucket); return new Promise(resolve => release.push(resolve));
  } });
  assert.deepEqual(started, ["public", "private"]);
  release.forEach(resolve => resolve());
  assert.deepEqual(await pending, { r2: "ok", r2Private: "ok" });
});

test("private denial makes overall health fail while preserving public success", async () => {
  const checks = await probeR2Health({ publicBucket: "public", privateBucket: "private", headBucket: async bucket => {
    if (bucket === "private") throw new Error("synthetic credential-bearing provider detail");
  } });
  assert.deepEqual(checks, { r2: "ok", r2Private: "fail" });
  const result = { ok: Object.values(checks).every(v => v === "ok"), checks, timestamp: 123 };
  assert.deepEqual(healthResponsePayload(result, false, false), { ok: false });
  assert.equal(JSON.stringify(checks).includes("credential"), false);
});

test("public failure is not masked by a successful private check", async () => {
  assert.deepEqual(await probeR2Health({ publicBucket: "public", privateBucket: "private", headBucket: async bucket => {
    if (bucket === "public") throw new Error("public failure");
  } }), { r2: "fail", r2Private: "ok" });
});

for (const privateBucket of [undefined, null, ""]) test(`public-only configuration (${String(privateBucket)}) does not acquire a private dependency`, async () => {
  const calls = [];
  assert.deepEqual(await probeR2Health({ publicBucket: "public", privateBucket, headBucket: async bucket => calls.push(bucket) }), { r2: "ok" });
  assert.deepEqual(calls, ["public"]);
});

for (const privateBucket of ["public", "   ", " private"]) test(`invalid private configuration ${JSON.stringify(privateBucket)} fails closed`, async () => {
  const calls = [];
  assert.deepEqual(await probeR2Health({ publicBucket: "public", privateBucket, headBucket: async bucket => calls.push(bucket) }), { r2: "ok", r2Private: "fail" });
  assert.deepEqual(calls, ["public"]);
});

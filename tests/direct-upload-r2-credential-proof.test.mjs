import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DIRECT_UPLOAD_R2_PROOF_BODY,
  DIRECT_UPLOAD_R2_PROOF_CONFIRMATION,
  parseDirectUploadR2ProofConfig,
  runDirectUploadR2CredentialProof,
} from "../scripts/direct-upload-r2-credential-proof.mjs";

function baseEnv(runnerTemp) {
  return {
    DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID:
      "0123456789abcdef0123456789abcdef",
    DIRECT_UPLOAD_CLEANUP_R2_ACCOUNT_ID:
      "0123456789abcdef0123456789abcdef",
    DIRECT_UPLOAD_CLEANUP_R2_PRIVATE_BUCKET: "grainline-private",
    DIRECT_UPLOAD_CLEANUP_R2_PUBLIC_BUCKET: "grainline-public",
    DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    DIRECT_UPLOAD_R2_PROOF_CONFIRM: DIRECT_UPLOAD_R2_PROOF_CONFIRMATION,
    DIRECT_UPLOAD_R2_PROOF_EVIDENCE_PATH: path.join(
      runnerTemp,
      "direct-upload-r2-credential-proof-123-1.json",
    ),
    DIRECT_UPLOAD_R2_PROOF_RELEASE_COMMIT: "a".repeat(40),
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "123",
    GITHUB_SHA: "a".repeat(40),
    RUNNER_TEMP: runnerTemp,
  };
}

describe("DirectUpload cleanup R2 credential proof", () => {
  it("accepts only exact manual-main cleanup-only configuration", () => {
    const runnerTemp = mkdtempSync(
      path.join(tmpdir(), "grainline-r2-proof-test-"),
    );
    try {
      const env = baseEnv(runnerTemp);
      const config = parseDirectUploadR2ProofConfig(env);
      assert.equal(config.releaseCommit, "a".repeat(40));
      assert.equal(config.publicBucket, "grainline-public");
      assert.match(config.credentialPairSha256, /^[a-f0-9]{64}$/);

      assert.throws(
        () =>
          parseDirectUploadR2ProofConfig({
            ...env,
            CLOUDFLARE_R2_ACCESS_KEY_ID:
              env.DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID,
          }),
        /forbidden shared credentials: CLOUDFLARE_R2_ACCESS_KEY_ID/,
      );
      assert.throws(
        () =>
          parseDirectUploadR2ProofConfig({
            ...env,
            DIRECT_UPLOAD_CLEANUP_DATABASE_URL: "postgresql://forbidden",
          }),
        /forbidden shared credentials: DIRECT_UPLOAD_CLEANUP_DATABASE_URL/,
      );
      assert.throws(
        () =>
          parseDirectUploadR2ProofConfig({
            ...env,
            DIRECT_UPLOAD_R2_PROOF_RELEASE_COMMIT: "b".repeat(40),
          }),
        /not the exact workflow commit/,
      );
      assert.throws(
        () =>
          parseDirectUploadR2ProofConfig({
            ...env,
            DIRECT_UPLOAD_CLEANUP_R2_PRIVATE_BUCKET: "grainline-public",
          }),
        /two distinct valid bucket names/,
      );
    } finally {
      rmSync(runnerTemp, { force: true, recursive: true });
    }
  });

  it("writes, verifies, deletes, and proves absence in both exact buckets", async () => {
    const calls = [];
    const states = new Map();
    const client = {
      async send(command) {
        const name = command.constructor.name;
        const { Bucket } = command.input;
        const key = command.input.Key ?? command.input.Prefix;
        calls.push({
          bucket: Bucket,
          key,
          maxKeys: command.input.MaxKeys,
          name,
        });
        const stateKey = `${Bucket}/${key}`;
        if (name === "ListObjectsV2Command") {
          const exists = states.has(stateKey);
          return {
            Contents: exists ? [{ Key: key }] : [],
            IsTruncated: false,
            KeyCount: exists ? 1 : 0,
          };
        }
        if (name === "PutObjectCommand") {
          assert.equal(command.input.IfNoneMatch, "*");
          states.set(stateKey, {
            CacheControl: command.input.CacheControl,
            ContentLength: Buffer.byteLength(command.input.Body),
            ContentType: command.input.ContentType,
          });
          return {};
        }
        if (name === "HeadObjectCommand") return states.get(stateKey);
        if (name === "DeleteObjectCommand") {
          states.delete(stateKey);
          return {};
        }
        throw new Error("unexpected command");
      },
    };
    const proof = await runDirectUploadR2CredentialProof({
      client,
      keyNonce: "00000000-0000-4000-8000-000000000000",
      privateBucket: "grainline-private",
      publicBucket: "grainline-public",
    });

    assert.equal(proof.complete, true);
    assert.equal(proof.results.length, 2);
    assert.deepEqual(
      proof.results.map((result) => ({
        deleted: result.deleted,
        finalAbsent: result.finalAbsent,
        storageClass: result.storageClass,
      })),
      [
        { deleted: true, finalAbsent: true, storageClass: "PUBLIC" },
        { deleted: true, finalAbsent: true, storageClass: "PRIVATE" },
      ],
    );
    assert.equal(states.size, 0);
    assert.equal(
      calls.filter((call) => call.name === "PutObjectCommand").length,
      2,
    );
    assert.equal(
      calls.filter((call) => call.name === "DeleteObjectCommand").length,
      2,
    );
    const listCalls = calls.filter(
      (call) => call.name === "ListObjectsV2Command",
    );
    assert.equal(listCalls.length, 4);
    assert.equal(
      listCalls.every(
        (call) =>
          call.maxKeys === 1
          && call.key.startsWith(
            ".grainline-ops/direct-upload-cleanup-credential-proof/",
          ),
      ),
      true,
    );
    assert.equal(
      JSON.stringify(proof).includes(
        ".grainline-ops/direct-upload-cleanup-credential-proof",
      ),
      false,
    );
    assert.equal(Buffer.byteLength(DIRECT_UPLOAD_R2_PROOF_BODY), 49);
  });

  it("fails closed and attempts residue cleanup without retaining provider text", async () => {
    let deleteCalls = 0;
    const client = {
      async send(command) {
        const name = command.constructor.name;
        if (name === "ListObjectsV2Command") {
          return { Contents: [], IsTruncated: false, KeyCount: 0 };
        }
        if (name === "PutObjectCommand") {
          return {};
        }
        if (name === "HeadObjectCommand") {
          return {
            CacheControl: "no-store",
            ContentLength: Buffer.byteLength(DIRECT_UPLOAD_R2_PROOF_BODY),
            ContentType: "text/plain; charset=utf-8",
          };
        }
        if (name === "DeleteObjectCommand") {
          deleteCalls += 1;
          const error = new Error(
            `Access denied for raw key ${command.input.Key}`,
          );
          error.name = "AccessDenied";
          error.$metadata = { httpStatusCode: 403 };
          throw error;
        }
        throw new Error("unexpected command");
      },
    };
    const proof = await runDirectUploadR2CredentialProof({
      client,
      keyNonce: "00000000-0000-4000-8000-000000000000",
      privateBucket: "grainline-private",
      publicBucket: "grainline-public",
    });

    assert.equal(proof.complete, false);
    assert.equal(proof.results.length, 1);
    assert.equal(proof.results[0].cleanupAttempted, true);
    assert.equal(proof.results[0].cleanupSucceeded, false);
    assert.equal(proof.results[0].residualPossible, true);
    assert.equal(deleteCalls, 2);
    assert.match(
      proof.results[0].failureCode,
      /^R2_PUBLIC_DELETE_403_ACCESSDENIED$/,
    );
    assert.match(
      proof.results[0].cleanupFailureCode,
      /^R2_PUBLIC_CLEANUP_403_ACCESSDENIED$/,
    );
    assert.equal(JSON.stringify(proof).includes("raw key"), false);
  });

  it("cleans an object when a put may commit before its response fails", async () => {
    let objectExists = false;
    let deleteCalls = 0;
    const client = {
      async send(command) {
        const name = command.constructor.name;
        if (name === "ListObjectsV2Command") {
          return {
            Contents: objectExists ? [{ Key: command.input.Prefix }] : [],
            IsTruncated: false,
            KeyCount: objectExists ? 1 : 0,
          };
        }
        if (name === "HeadObjectCommand") {
          return {
            CacheControl: "no-store",
            ContentLength: Buffer.byteLength(DIRECT_UPLOAD_R2_PROOF_BODY),
            ContentType: "text/plain; charset=utf-8",
          };
        }
        if (name === "PutObjectCommand") {
          objectExists = true;
          const error = new Error("ambiguous response after provider commit");
          error.name = "TimeoutError";
          throw error;
        }
        if (name === "DeleteObjectCommand") {
          deleteCalls += 1;
          objectExists = false;
          return {};
        }
        throw new Error("unexpected command");
      },
    };
    const proof = await runDirectUploadR2CredentialProof({
      client,
      keyNonce: "00000000-0000-4000-8000-000000000000",
      privateBucket: "grainline-private",
      publicBucket: "grainline-public",
    });

    assert.equal(proof.complete, false);
    assert.equal(proof.results.length, 1);
    assert.equal(proof.results[0].failureCode, "R2_PUBLIC_PUT_UNKNOWN_TIMEOUTERROR");
    assert.equal(proof.results[0].cleanupAttempted, true);
    assert.equal(proof.results[0].cleanupSucceeded, true);
    assert.equal(proof.results[0].residualPossible, false);
    assert.equal(objectExists, false);
    assert.equal(deleteCalls, 1);
    assert.equal(
      JSON.stringify(proof).includes("ambiguous response"),
      false,
    );
  });

  it("fails closed when an exact-prefix absence listing is not empty", async () => {
    const calls = [];
    const client = {
      async send(command) {
        calls.push(command);
        if (command.constructor.name !== "ListObjectsV2Command") {
          throw new Error("proof continued after a non-empty preflight");
        }
        return {
          Contents: [{ Key: `${command.input.Prefix}-unexpected` }],
          IsTruncated: false,
          KeyCount: 1,
        };
      },
    };
    const proof = await runDirectUploadR2CredentialProof({
      client,
      keyNonce: "00000000-0000-4000-8000-000000000000",
      privateBucket: "grainline-private",
      publicBucket: "grainline-public",
    });

    assert.equal(proof.complete, false);
    assert.equal(proof.results.length, 1);
    assert.equal(
      proof.results[0].failureCode,
      "R2_PROOF_KEY_ALREADY_EXISTS",
    );
    assert.equal(proof.results[0].preflightAbsent, false);
    assert.equal(proof.results[0].wrote, false);
    assert.equal(proof.results[0].residualPossible, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input.MaxKeys, 1);
    assert.equal(
      calls[0].input.Prefix,
      ".grainline-ops/direct-upload-cleanup-credential-proof/"
        + "00000000-0000-4000-8000-000000000000-public.txt",
    );
  });

  it("keeps proof manual, main-only, isolated, and evidence-only", () => {
    const workflow = readFileSync(
      ".github/workflows/direct-upload-r2-credential-proof.yml",
      "utf8",
    );
    const script = readFileSync(
      "scripts/direct-upload-r2-credential-proof.mjs",
      "utf8",
    );

    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /^\s*schedule:/m);
    assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /environment: Production DirectUpload Cleanup/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /npm ci --ignore-scripts/);
    assert.doesNotMatch(workflow, /DIRECT_UPLOAD_CLEANUP_DATABASE_URL:/);
    assert.doesNotMatch(workflow, /CLOUDFLARE_R2_ACCESS_KEY_ID:/);
    assert.match(script, /PutObjectCommand/);
    assert.match(script, /HeadObjectCommand/);
    assert.match(script, /ListObjectsV2Command/);
    assert.match(script, /DeleteObjectCommand/);
    assert.match(script, /MaxKeys: 1/);
    assert.match(script, /Prefix: key/);
    assert.match(script, /schemaVersion: 2/);
    assert.match(script, /DirectUpload R2 proof evidence mode is not 0600/);
  });
});

#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  assertDirectUploadCleanupGitState,
  readDirectUploadCleanupGitState,
} from "./direct-upload-cleanup-worker.mjs";

export const DIRECT_UPLOAD_R2_PROOF_CONFIRMATION =
  "prove-reviewed-direct-upload-cleanup-r2";
export const DIRECT_UPLOAD_R2_PROOF_BODY =
  "grainline direct upload cleanup credential proof\n";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const SAFE_RUN_ATTEMPT_PATTERN = /^[1-9][0-9]{0,5}$/;
const SAFE_R2_ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const SAFE_BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const SAFE_ACCESS_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const SAFE_SECRET_KEY_PATTERN = /^[A-Za-z0-9_+/=-]{32,256}$/;
const PROOF_PREFIX = ".grainline-ops/direct-upload-cleanup-credential-proof";
const FORBIDDEN_ENV_KEYS = Object.freeze([
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_ACCOUNT_ID",
  "CLOUDFLARE_R2_BUCKET_NAME",
  "CLOUDFLARE_R2_PRIVATE_BUCKET_NAME",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  "DATABASE_URL",
  "DIRECT_URL",
  "DIRECT_UPLOAD_CLEANUP_DATABASE_URL",
  "GRANT_AUDIT_DATABASE_URL",
  "PRODUCTION_MIGRATION_DIRECT_URL",
]);

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function exactEvidencePath(env) {
  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(
    required(env, "DIRECT_UPLOAD_R2_PROOF_EVIDENCE_PATH"),
  );
  const expected = path.join(
    runnerTemp,
    `direct-upload-r2-credential-proof-${required(env, "GITHUB_RUN_ID")}-${required(env, "GITHUB_RUN_ATTEMPT")}.json`,
  );
  if (evidencePath !== expected || existsSync(evidencePath)) {
    throw new Error(
      "DirectUpload R2 proof evidence path is not the fresh reviewed runner path",
    );
  }
  return evidencePath;
}

export function parseDirectUploadR2ProofConfig(env = process.env) {
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error(
      "DirectUpload R2 proof requires a manual main-branch GitHub Actions run",
    );
  }
  if (
    env.DIRECT_UPLOAD_R2_PROOF_CONFIRM
    !== DIRECT_UPLOAD_R2_PROOF_CONFIRMATION
  ) {
    throw new Error("DirectUpload R2 proof confirmation is not exact");
  }
  const forbiddenPresent = FORBIDDEN_ENV_KEYS.filter((key) =>
    Object.hasOwn(env, key),
  );
  if (forbiddenPresent.length > 0) {
    throw new Error(
      `DirectUpload R2 proof contains forbidden shared credentials: ${forbiddenPresent.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "DIRECT_UPLOAD_R2_PROOF_RELEASE_COMMIT",
  );
  const githubSha = required(env, "GITHUB_SHA");
  if (
    !COMMIT_PATTERN.test(releaseCommit)
    || githubSha !== releaseCommit
  ) {
    throw new Error(
      "DirectUpload R2 proof release commit is not the exact workflow commit",
    );
  }
  const runId = required(env, "GITHUB_RUN_ID");
  const runAttempt = required(env, "GITHUB_RUN_ATTEMPT");
  if (
    !SAFE_RUN_ID_PATTERN.test(runId)
    || !SAFE_RUN_ATTEMPT_PATTERN.test(runAttempt)
  ) {
    throw new Error("DirectUpload R2 proof run identity is invalid");
  }

  const accountId = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_R2_ACCOUNT_ID",
  );
  const accessKeyId = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID",
  );
  const secretAccessKey = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY",
  );
  const publicBucket = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_R2_PUBLIC_BUCKET",
  );
  const privateBucket = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_R2_PRIVATE_BUCKET",
  );
  if (!SAFE_R2_ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error("DirectUpload R2 proof account id is invalid");
  }
  if (
    !SAFE_ACCESS_KEY_PATTERN.test(accessKeyId)
    || !SAFE_SECRET_KEY_PATTERN.test(secretAccessKey)
  ) {
    throw new Error(
      "DirectUpload R2 proof cleanup credential shape is invalid",
    );
  }
  if (
    !SAFE_BUCKET_PATTERN.test(publicBucket)
    || !SAFE_BUCKET_PATTERN.test(privateBucket)
    || publicBucket === privateBucket
  ) {
    throw new Error(
      "DirectUpload R2 proof requires two distinct valid bucket names",
    );
  }

  return Object.freeze({
    accessKeyId,
    accountId,
    accountIdSha256: sha256(accountId),
    credentialPairSha256: sha256(`${accessKeyId}\0${secretAccessKey}`),
    evidencePath: exactEvidencePath(env),
    privateBucket,
    privateBucketSha256: sha256(privateBucket),
    publicBucket,
    publicBucketSha256: sha256(publicBucket),
    releaseCommit,
    runAttempt,
    runId,
    secretAccessKey,
  });
}

function safeProviderCode(error, stage) {
  if (error?.proofCode) return error.proofCode;
  const status = Number(error?.$metadata?.httpStatusCode);
  const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599
    ? String(status)
    : "UNKNOWN";
  const rawName = error instanceof Error ? error.name : "";
  const safeName = /^[A-Za-z][A-Za-z0-9]{0,49}$/.test(rawName)
    ? rawName.toUpperCase()
    : "ERROR";
  return `R2_${stage}_${safeStatus}_${safeName}`;
}

function proofError(code) {
  const error = new Error(code);
  error.proofCode = code;
  return error;
}

async function assertObjectAbsent(client, bucket, key) {
  const listed = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      MaxKeys: 1,
      Prefix: key,
    }),
  );
  const contents = Array.isArray(listed.Contents) ? listed.Contents : [];
  const keyCount = listed.KeyCount === undefined
    ? contents.length
    : Number(listed.KeyCount);
  if (
    !Number.isInteger(keyCount)
    || keyCount < 0
    || keyCount > 1
    || contents.length > 1
    || listed.IsTruncated === true
    || listed.NextContinuationToken !== undefined
  ) {
    throw proofError("R2_PROOF_ABSENCE_LIST_AMBIGUOUS");
  }
  if (keyCount !== 0 || contents.length !== 0) {
    throw proofError("R2_PROOF_KEY_ALREADY_EXISTS");
  }
}

async function proveBucket({ bucket, client, key, storageClass }) {
  const keySha256 = sha256(key);
  let objectMayExist = false;
  let stage = `${storageClass}_PREFLIGHT_LIST`;
  const result = {
    cleanupAttempted: false,
    cleanupSucceeded: false,
    deleted: false,
    failureCode: null,
    finalAbsent: false,
    headVerified: false,
    keySha256,
    preflightAbsent: false,
    storageClass,
    wrote: false,
  };
  try {
    await assertObjectAbsent(client, bucket, key);
    result.preflightAbsent = true;
    stage = `${storageClass}_PUT`;
    objectMayExist = true;
    try {
      await client.send(
        new PutObjectCommand({
          Body: DIRECT_UPLOAD_R2_PROOF_BODY,
          Bucket: bucket,
          CacheControl: "no-store",
          ContentType: "text/plain; charset=utf-8",
          IfNoneMatch: "*",
          Key: key,
        }),
      );
    } catch (error) {
      if (Number(error?.$metadata?.httpStatusCode) === 412) {
        objectMayExist = false;
      }
      throw error;
    }
    result.wrote = true;

    stage = `${storageClass}_HEAD`;
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (
      Number(head.ContentLength) !==
        Buffer.byteLength(DIRECT_UPLOAD_R2_PROOF_BODY)
      || head.ContentType !== "text/plain; charset=utf-8"
      || head.CacheControl !== "no-store"
    ) {
      throw proofError(`R2_${storageClass}_HEAD_METADATA_MISMATCH`);
    }
    result.headVerified = true;

    stage = `${storageClass}_DELETE`;
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
    result.deleted = true;

    stage = `${storageClass}_FINAL_LIST`;
    await assertObjectAbsent(client, bucket, key);
    objectMayExist = false;
    result.finalAbsent = true;
  } catch (error) {
    result.failureCode = safeProviderCode(error, stage);
  } finally {
    if (objectMayExist) {
      result.cleanupAttempted = true;
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
        await assertObjectAbsent(client, bucket, key);
        objectMayExist = false;
        result.cleanupSucceeded = true;
        result.finalAbsent = true;
      } catch (error) {
        result.cleanupFailureCode = safeProviderCode(
          error,
          `${storageClass}_CLEANUP`,
        );
      }
    }
    result.residualPossible = objectMayExist;
  }
  return Object.freeze(result);
}

export async function runDirectUploadR2CredentialProof({
  client,
  privateBucket,
  publicBucket,
  keyNonce = randomUUID(),
}) {
  if (!/^[0-9a-f-]{36}$/.test(keyNonce)) {
    throw new Error("DirectUpload R2 proof key nonce is invalid");
  }
  const results = [];
  for (const target of [
    { bucket: publicBucket, storageClass: "PUBLIC" },
    { bucket: privateBucket, storageClass: "PRIVATE" },
  ]) {
    const key = `${PROOF_PREFIX}/${keyNonce}-${target.storageClass.toLowerCase()}.txt`;
    const result = await proveBucket({
      ...target,
      client,
      key,
    });
    results.push(result);
    if (result.failureCode || result.residualPossible) break;
  }
  return Object.freeze({
    complete:
      results.length === 2
      && results.every(
        (result) =>
          result.preflightAbsent
          && result.wrote
          && result.headVerified
          && result.deleted
          && result.finalAbsent
          && !result.failureCode
          && !result.residualPossible,
      ),
    results: Object.freeze(results),
  });
}

function writeEvidence(pathname, evidence) {
  const descriptor = openSync(pathname, "wx", 0o600);
  try {
    writeFileSync(
      descriptor,
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(pathname, 0o600);
  if (
    !lstatSync(pathname).isFile()
    || (lstatSync(pathname).mode & 0o777) !== 0o600
  ) {
    throw new Error("DirectUpload R2 proof evidence mode is not 0600");
  }
}

async function main() {
  const config = parseDirectUploadR2ProofConfig(process.env);
  const git = assertDirectUploadCleanupGitState(
    readDirectUploadCleanupGitState(),
    config.releaseCommit,
  );
  const client = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    region: "auto",
  });
  const startedAt = new Date().toISOString();
  let proof;
  try {
    proof = await runDirectUploadR2CredentialProof({
      client,
      privateBucket: config.privateBucket,
      publicBucket: config.publicBucket,
    });
  } finally {
    client.destroy();
  }
  const evidence = Object.freeze({
    operation: "direct-upload-r2-cleanup-credential-proof",
    proof,
    run: Object.freeze({
      attempt: config.runAttempt,
      completedAt: new Date().toISOString(),
      id: config.runId,
      startedAt,
    }),
    schemaVersion: 2,
    source: Object.freeze({
      clean: git.clean,
      commit: git.head,
    }),
    target: Object.freeze({
      accountIdSha256: config.accountIdSha256,
      credentialPairSha256: config.credentialPairSha256,
      privateBucketSha256: config.privateBucketSha256,
      publicBucketSha256: config.publicBucketSha256,
    }),
  });
  writeEvidence(config.evidencePath, evidence);
  process.stdout.write(
    `${JSON.stringify({
      complete: proof.complete,
      provedBuckets: proof.results.length,
      residualPossible: proof.results.some(
        (result) => result.residualPossible,
      ),
    })}\n`,
  );
  if (!proof.complete) {
    const codes = proof.results
      .flatMap((result) =>
        [result.failureCode, result.cleanupFailureCode].filter(Boolean),
      )
      .join(",");
    throw new Error(
      `DirectUpload R2 proof failed closed [${codes || "INCOMPLETE"}]`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message =
      error instanceof Error
        ? error.message
        : "DirectUpload R2 proof failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

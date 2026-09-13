#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { assertPublicMediaAvailable } from "../src/lib/publicMediaAvailability.ts";
import { uploadTelemetryKeyHash } from "../src/lib/uploadTelemetry.ts";
import {
  uploadedObjectVerificationError,
  uploadFileSignatureMatches,
} from "../src/lib/uploadVerificationToken.ts";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIRMATION_VALUE = "write-delete";
const DEFAULT_CACHE_CONTROL = "public, max-age=31536000, immutable";
const EVIDENCE_MAX_ISSUES = 20;
const ROOT_PROBE_MAX_BYTES = 16 * 1024;

const R2_ENV_ASSIGNMENT_PATTERN =
  /["']?\b(?:CLOUDFLARE_R2_(?:ACCOUNT_ID|ACCESS_KEY_ID|SECRET_ACCESS_KEY|BUCKET_NAME|PUBLIC_URL)|R2_UPLOAD_SMOKE_[A-Z0-9_]+|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function redact(value) {
  return String(value ?? "")
    .replace(R2_ENV_ASSIGNMENT_PATTERN, "[redacted-r2-env-assignment]")
    .replace(URL_USERINFO_PATTERN, "$1[redacted-credentials]@")
    .replace(BEARER_PATTERN, "Bearer [redacted-token]");
}

function safeError(error) {
  if (error instanceof Error) return redact(error.message || error.name);
  return redact(String(error));
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertSafeRunId(value) {
  const runId = value || `r2smoke_${new Date().toISOString().replace(/[^0-9A-Za-z]+/g, "_").replace(/_+$/g, "")}`;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(runId)) {
    throw new Error("R2_UPLOAD_SMOKE_RUN_ID must be 8-80 URL-safe characters");
  }
  return runId;
}

function evidencePathFromEnv(env) {
  const raw = required(env, "R2_UPLOAD_SMOKE_EVIDENCE_PATH");
  if (raw.includes("\0")) throw new Error("R2_UPLOAD_SMOKE_EVIDENCE_PATH must not contain null bytes");
  const resolved = path.resolve(ROOT_DIR, raw);
  if (resolved !== ROOT_DIR && !resolved.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new Error("R2_UPLOAD_SMOKE_EVIDENCE_PATH must stay inside the repository");
  }
  return resolved;
}

function publicBaseFromEnv(env) {
  const raw = required(env, "CLOUDFLARE_R2_PUBLIC_URL");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("CLOUDFLARE_R2_PUBLIC_URL must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("CLOUDFLARE_R2_PUBLIC_URL must be HTTPS for launch smoke evidence");
  }
  return parsed;
}

export function parseConfig(env = process.env) {
  if (env.R2_UPLOAD_SMOKE_CONFIRM !== CONFIRMATION_VALUE) {
    throw new Error(`R2_UPLOAD_SMOKE_CONFIRM=${CONFIRMATION_VALUE} is required before writing smoke objects`);
  }

  const accountId = required(env, "CLOUDFLARE_R2_ACCOUNT_ID");
  const accessKeyId = required(env, "CLOUDFLARE_R2_ACCESS_KEY_ID");
  const secretAccessKey = required(env, "CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  const bucket = required(env, "CLOUDFLARE_R2_BUCKET_NAME");
  const publicBaseUrl = publicBaseFromEnv(env);

  return {
    accountId,
    accessKeyId,
    bucket,
    evidencePath: evidencePathFromEnv(env),
    publicBaseUrl,
    runId: assertSafeRunId(env.R2_UPLOAD_SMOKE_RUN_ID),
    secretAccessKey,
  };
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT_DIR, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function createR2Client(config) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function publicUrlForKey(config, key) {
  const base = config.publicBaseUrl.href.replace(/\/$/, "");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encodedKey}`;
}

function publicRootUrl(config) {
  const base = new URL(config.publicBaseUrl.href);
  if (!base.pathname.endsWith("/")) base.pathname = `${base.pathname}/`;
  base.search = "";
  base.hash = "";
  return base.href;
}

function sanitizeHeaders(headers) {
  return {
    cacheControl: headers.CacheControl ?? null,
    contentLength: headers.ContentLength ?? null,
    contentType: headers.ContentType ?? null,
  };
}

async function objectPrefixBytes(client, config, key) {
  const response = await client.send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Range: "bytes=0-511",
  }));
  const body = response.Body;
  if (!body?.transformToByteArray) return new Uint8Array();
  return body.transformToByteArray();
}

async function generateProcessedImageBody() {
  return sharp({
    create: {
      width: 4,
      height: 4,
      channels: 3,
      background: { r: 156, g: 108, b: 60 },
    },
  })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

function directPdfBody() {
  return Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", "utf8");
}

async function putAndVerifyObject({
  body,
  client,
  config,
  contentType,
  key,
  scenario,
}) {
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ContentLength: body.byteLength,
    CacheControl: DEFAULT_CACHE_CONTROL,
  }));

  const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
  const verificationError = uploadedObjectVerificationError({
    actualSize: head.ContentLength ?? 0,
    expectedSize: body.byteLength,
    maxSize: body.byteLength,
    actualContentType: head.ContentType,
    expectedContentType: contentType,
  });
  if (verificationError) throw new Error(`${scenario}: ${verificationError}`);
  if (head.CacheControl !== DEFAULT_CACHE_CONTROL) {
    throw new Error(`${scenario}: Cache-Control was ${head.CacheControl ?? "missing"}`);
  }

  const prefixBytes = await objectPrefixBytes(client, config, key);
  if (!uploadFileSignatureMatches(prefixBytes, contentType)) {
    throw new Error(`${scenario}: object bytes did not match ${contentType}`);
  }

  const publicUrl = publicUrlForKey(config, key);
  await assertPublicMediaAvailable(publicUrl);

  return {
    cacheControl: head.CacheControl ?? null,
    contentLength: head.ContentLength ?? null,
    contentType: head.ContentType ?? null,
    keyHash: uploadTelemetryKeyHash(key),
    publicAvailable: true,
    scenario,
    signatureVerified: true,
  };
}

async function probePublicBucketListing(config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(publicRootUrl(config), {
      cache: "no-store",
      method: "GET",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const sample = text.slice(0, ROOT_PROBE_MAX_BYTES);
    const listBucketXmlDetected =
      response.ok &&
      /<ListBucketResult\b/i.test(sample) &&
      /<(Contents|Key|Name)\b/i.test(sample);

    if (listBucketXmlDetected) {
      throw new Error("public R2 root appears to expose a ListBucket XML response");
    }

    return {
      contentType,
      listBucketXmlDetected,
      publicRootStatus: response.status,
      result: response.ok ? "no-listing-xml-detected" : "blocked-or-not-found",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function cleanupObjects(client, config, keys) {
  const results = [];
  for (const key of keys) {
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    results.push({ keyHash: uploadTelemetryKeyHash(key), deleted: true });
  }
  return results;
}

export function buildEvidencePayload({ checks, config, issues, startedAt, completedAt, status }) {
  return {
    status,
    generatedAt: completedAt,
    startedAt,
    completedAt,
    commitSha: process.env.R2_UPLOAD_SMOKE_COMMIT_SHA || process.env.GITHUB_SHA || gitHead(),
    ciRunId: process.env.R2_UPLOAD_SMOKE_CI_RUN_ID || process.env.GITHUB_RUN_ID || null,
    runId: config?.runId ?? null,
    r2: {
      bucketHash: config ? uploadTelemetryKeyHash(config.bucket) : null,
      publicOrigin: config?.publicBaseUrl?.origin ?? null,
      publicPathPrefix: config?.publicBaseUrl?.pathname?.replace(/\/$/, "") || "",
    },
    checks,
    issues: issues.slice(0, EVIDENCE_MAX_ISSUES).map(redact),
  };
}

function writeEvidence(config, payload) {
  mkdirSync(path.dirname(config.evidencePath), { recursive: true });
  writeFileSync(config.evidencePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function runR2UploadSmoke(env = process.env) {
  const startedAt = new Date().toISOString();
  let config;
  const checks = [];
  const issues = [];
  let status = "passed";
  let client;
  const writtenKeys = [];

  try {
    config = parseConfig(env);
    client = createR2Client(config);
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    checks.push({ name: "head-bucket", status: "passed" });

    const keyPrefix = `grainline-smoke/${config.runId}/${Date.now()}-${randomUUID()}`;
    const processedKey = `blogImage/${keyPrefix}-processed.jpg`;
    const directKey = `messageFile/${keyPrefix}-direct.pdf`;

    const processedBody = await generateProcessedImageBody();
    writtenKeys.push(processedKey);
    checks.push({
      name: "processed-image-object",
      status: "passed",
      ...(await putAndVerifyObject({
        body: processedBody,
        client,
        config,
        contentType: "image/jpeg",
        key: processedKey,
        scenario: "processed-image-object",
      })),
    });

    const pdfBody = directPdfBody();
    writtenKeys.push(directKey);
    checks.push({
      name: "direct-upload-object",
      status: "passed",
      ...(await putAndVerifyObject({
        body: pdfBody,
        client,
        config,
        contentType: "application/pdf",
        key: directKey,
        scenario: "direct-upload-object",
      })),
    });

    checks.push({
      name: "public-bucket-listing-probe",
      status: "passed",
      ...(await probePublicBucketListing(config)),
    });
  } catch (error) {
    status = "failed";
    issues.push(safeError(error));
  } finally {
    if (client && config && writtenKeys.length > 0) {
      try {
        checks.push({
          name: "cleanup",
          status: "passed",
          objects: await cleanupObjects(client, config, writtenKeys),
        });
      } catch (error) {
        status = "failed";
        issues.push(`cleanup failed: ${safeError(error)}`);
      }
    }
  }

  const completedAt = new Date().toISOString();
  const payload = buildEvidencePayload({ checks, config, issues, startedAt, completedAt, status });
  if (config) writeEvidence(config, payload);
  if (status !== "passed") {
    throw new Error(`R2 upload smoke failed: ${issues.join("; ")}`);
  }
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runR2UploadSmoke()
    .then((payload) => {
      console.log(`R2 upload smoke passed for run ${payload.runId}`);
      console.log(`R2 upload smoke evidence written to ${process.env.R2_UPLOAD_SMOKE_EVIDENCE_PATH}`);
    })
    .catch((error) => {
      console.error(safeError(error));
      process.exitCode = 1;
    });
}

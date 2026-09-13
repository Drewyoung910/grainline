#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIRMATION_VALUE = "production-read";
const DEFAULT_PROOF_URL = "https://thegrainline.com";
const EVIDENCE_MAX_ISSUES = 20;
const REQUIRED_HOST = "thegrainline.com";

const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const HEADER_PROOF_ENV_PATTERN =
  /["']?\b(?:DEPLOYED_HEADERS_PROOF_[A-Z0-9_]+)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

const REQUIRED_HEADER_VALUES = [
  ["x-dns-prefetch-control", "on"],
  ["x-frame-options", "SAMEORIGIN"],
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["cross-origin-opener-policy", "same-origin-allow-popups"],
  ["cross-origin-resource-policy", "same-site"],
  ["permissions-policy", "camera=(), microphone=(), geolocation=(self)"],
  ["reporting-endpoints", 'csp-endpoint="/api/csp-report"'],
];

const REQUIRED_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-elem 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "report-to csp-endpoint",
  "report-uri /api/csp-report",
];

function redact(value) {
  return String(value ?? "")
    .replace(HEADER_PROOF_ENV_PATTERN, "[redacted-header-proof-env]")
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

function parseBooleanFlag(env, name) {
  return env[name] === "1" || env[name] === "true";
}

function evidencePathFromEnv(env) {
  const raw = required(env, "DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH");
  if (raw.includes("\0")) throw new Error("DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH must not contain null bytes");
  const resolved = path.resolve(ROOT_DIR, raw);
  if (resolved !== ROOT_DIR && !resolved.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new Error("DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH must stay inside the repository");
  }
  return resolved;
}

function proofUrlFromEnv(env) {
  const raw = env.DEPLOYED_HEADERS_PROOF_URL || DEFAULT_PROOF_URL;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DEPLOYED_HEADERS_PROOF_URL must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("DEPLOYED_HEADERS_PROOF_URL must be HTTPS");
  }
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

export function parseConfig(env = process.env) {
  if (env.DEPLOYED_HEADERS_PROOF_CONFIRM !== CONFIRMATION_VALUE) {
    throw new Error(`DEPLOYED_HEADERS_PROOF_CONFIRM=${CONFIRMATION_VALUE} is required`);
  }
  const url = proofUrlFromEnv(env);
  if (url.hostname !== REQUIRED_HOST && !parseBooleanFlag(env, "DEPLOYED_HEADERS_PROOF_ALLOW_CUSTOM_HOST")) {
    throw new Error(`DEPLOYED_HEADERS_PROOF_URL must target ${REQUIRED_HOST} unless DEPLOYED_HEADERS_PROOF_ALLOW_CUSTOM_HOST=1`);
  }
  return {
    evidencePath: evidencePathFromEnv(env),
    url,
  };
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT_DIR, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function headerValue(headers, name) {
  return headers.get(name) ?? "";
}

function normalizeHeaderValue(value) {
  return value.trim().replace(/\s+/g, " ");
}

function assertEqualHeader(headers, name, expected) {
  const actual = normalizeHeaderValue(headerValue(headers, name));
  if (actual !== expected) {
    throw new Error(`${name} was ${actual || "missing"}, expected ${expected}`);
  }
  return { name, value: actual };
}

function assertHsts(headers) {
  const value = headerValue(headers, "strict-transport-security");
  const normalized = normalizeHeaderValue(value).toLowerCase();
  const maxAge = Number(normalized.match(/(?:^|;\s*)max-age=(\d+)/)?.[1] ?? 0);
  if (!Number.isSafeInteger(maxAge) || maxAge < 63_072_000) {
    throw new Error("strict-transport-security max-age is missing or below 63072000");
  }
  if (!/(?:^|;\s*)includesubdomains(?:;|$)/i.test(normalized)) {
    throw new Error("strict-transport-security missing includeSubDomains");
  }
  if (!/(?:^|;\s*)preload(?:;|$)/i.test(normalized)) {
    throw new Error("strict-transport-security missing preload directive");
  }
  return { maxAge, value };
}

function assertCsp(headers) {
  const value = headerValue(headers, "content-security-policy");
  if (!value) throw new Error("content-security-policy missing");
  if (headerValue(headers, "content-security-policy-report-only")) {
    throw new Error("content-security-policy-report-only should not replace enforced CSP");
  }
  const missingDirectives = REQUIRED_CSP_DIRECTIVES.filter((directive) => !value.includes(directive));
  if (missingDirectives.length > 0) {
    throw new Error(`content-security-policy missing directives: ${missingDirectives.join(", ")}`);
  }
  if (value.includes("'unsafe-eval'")) {
    throw new Error("content-security-policy allows unsafe-eval");
  }
  return {
    directiveCount: value.split(";").map((part) => part.trim()).filter(Boolean).length,
    requiredDirectives: REQUIRED_CSP_DIRECTIVES,
  };
}

function assertPoweredByAbsent(headers) {
  const value = headerValue(headers, "x-powered-by");
  if (value) throw new Error(`x-powered-by should be absent, got ${value}`);
  return { name: "x-powered-by", value: null };
}

async function fetchNoRedirect(url) {
  return fetch(url, {
    cache: "no-store",
    redirect: "manual",
  });
}

async function checkRootHeaders(config) {
  const response = await fetchNoRedirect(config.url);
  if (response.status !== 200) {
    throw new Error(`root responded with HTTP ${response.status}`);
  }
  const headers = response.headers;
  return {
    headers: {
      csp: assertCsp(headers),
      hsts: assertHsts(headers),
      poweredBy: assertPoweredByAbsent(headers),
      exact: REQUIRED_HEADER_VALUES.map(([name, expected]) => assertEqualHeader(headers, name, expected)),
    },
    httpStatus: response.status,
  };
}

async function checkHealthHeaders(config) {
  const healthUrl = new URL("/api/health", config.url);
  const response = await fetchNoRedirect(healthUrl);
  if (response.status !== 200) {
    throw new Error(`/api/health responded with HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body?.ok !== true) {
    throw new Error("/api/health did not return ok=true");
  }
  const cacheControl = normalizeHeaderValue(headerValue(response.headers, "cache-control"));
  if (!cacheControl.includes("private") || !cacheControl.includes("no-store") || !cacheControl.includes("max-age=0")) {
    throw new Error(`/api/health cache-control was ${cacheControl || "missing"}`);
  }
  const vary = normalizeHeaderValue(headerValue(response.headers, "vary")).toLowerCase();
  for (const requiredVary of ["authorization", "x-health-check-token"]) {
    if (!vary.includes(requiredVary)) {
      throw new Error(`/api/health vary missing ${requiredVary}`);
    }
  }
  return {
    cacheControl,
    httpStatus: response.status,
    vary,
  };
}

export function buildEvidencePayload({ checks, config, issues, startedAt, completedAt, status }) {
  return {
    status,
    generatedAt: completedAt,
    startedAt,
    completedAt,
    commitSha: process.env.DEPLOYED_HEADERS_PROOF_COMMIT_SHA || process.env.GITHUB_SHA || gitHead(),
    ciRunId: process.env.DEPLOYED_HEADERS_PROOF_CI_RUN_ID || process.env.GITHUB_RUN_ID || null,
    target: {
      origin: config?.url?.origin ?? null,
      host: config?.url?.hostname ?? null,
    },
    checks,
    issues: issues.slice(0, EVIDENCE_MAX_ISSUES).map(redact),
  };
}

function writeEvidence(config, payload) {
  mkdirSync(path.dirname(config.evidencePath), { recursive: true });
  writeFileSync(config.evidencePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function runDeployedHeadersProof(env = process.env) {
  const startedAt = new Date().toISOString();
  let config;
  const checks = [];
  const issues = [];
  let status = "passed";

  try {
    config = parseConfig(env);
    checks.push({
      name: "root-security-headers",
      status: "passed",
      ...(await checkRootHeaders(config)),
    });
    checks.push({
      name: "health-private-cache-headers",
      status: "passed",
      ...(await checkHealthHeaders(config)),
    });
  } catch (error) {
    status = "failed";
    issues.push(safeError(error));
  }

  const completedAt = new Date().toISOString();
  const payload = buildEvidencePayload({ checks, config, issues, startedAt, completedAt, status });
  if (config) writeEvidence(config, payload);
  if (status !== "passed") {
    throw new Error(`Deployed security headers proof failed: ${issues.join("; ")}`);
  }
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDeployedHeadersProof()
    .then((payload) => {
      console.log(`Deployed security headers proof passed for ${payload.target.origin}`);
      console.log(`Deployed security headers evidence written to ${process.env.DEPLOYED_HEADERS_PROOF_EVIDENCE_PATH}`);
    })
    .catch((error) => {
      console.error(safeError(error));
      process.exitCode = 1;
    });
}

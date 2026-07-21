#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  REVIEWED_DATABASE_NAME,
  REVIEWED_DATABASE_REGION,
  REVIEWED_ENDPOINT_ID,
  REVIEWED_OWNER_ROLE,
} from "./saved-search-phase-b-owner-rotation.mjs";
import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";

export const REVIEWED_NEON_PROJECT_ID = "icy-unit-96812898";
export const REVIEWED_NEON_BRANCH_ID = "br-hidden-mouse-aaugn2wr";
export const REVIEWED_NEON_BRANCH_NAME = "production";
export const REVIEWED_NEON_ORG_ID = "org-raspy-frost-18952075";
export const REVIEWED_NEON_CLI_PATH =
  "/Users/drewyoung/.npm/_npx/74274893b9fe65d3/node_modules/neonctl/dist/cli.js";
export const REVIEWED_NEON_CLI_VERSION = "2.35.1";
export const REVIEWED_NEON_CREDENTIAL_PATH =
  "/Users/drewyoung/.config/neonctl/credentials.json";
export const NEON_OWNER_PASSWORD_PATTERN = /^[A-Za-z0-9_-]{16}$/;

const OPERATION_ATTEMPTS = 16;
const OPERATION_INTERVAL_MS = 2_000;
const GET_ATTEMPTS = 3;
const GET_RETRY_INTERVAL_MS = 500;

function cleanEnvironment(env = process.env) {
  const child = { ...env };
  for (const [key, value] of Object.entries(child)) {
    if (
      key === "DATABASE_URL"
      || /^PG[A-Z0-9_]*$/.test(key)
      || /(?:^|_)(?:DIRECT_URL|DATABASE_URL|DB_ADMIN_URL)$/.test(key)
      || (
        typeof value === "string"
        && /^postgres(?:ql)?:\/\//i.test(value.trim())
      )
    ) {
      delete child[key];
    }
  }
  return child;
}

export function assertReviewedNeonCli() {
  const packagePath = path.resolve(
    path.dirname(REVIEWED_NEON_CLI_PATH),
    "..",
    "package.json",
  );
  const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
  const credentialStat = statSync(REVIEWED_NEON_CREDENTIAL_PATH);
  if (
    metadata?.name !== "neonctl"
    || metadata.version !== REVIEWED_NEON_CLI_VERSION
    || !credentialStat.isFile()
    || (credentialStat.mode & 0o077) !== 0
  ) {
    throw new Error("Neon CLI package or private credential file does not match the reviewed operator");
  }
  return Object.freeze({ name: metadata.name, version: metadata.version });
}

function runNeonApi(pathname, method = "GET") {
  const attempts = method === "GET" ? GET_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    assertReviewedNeonCli();
    const result = spawnSync(
      process.execPath,
      [
        REVIEWED_NEON_CLI_PATH,
        "api",
        pathname,
        "--method",
        method,
        "--output",
        "json",
        "--no-color",
        "--no-analytics",
      ],
      {
        env: cleanEnvironment(),
        encoding: "utf8",
        timeout: 45_000,
        maxBuffer: 1024 * 1024,
      },
    );
    if (!result.error && result.status === 0) {
      try {
        return JSON.parse(result.stdout);
      } catch {
        throw new Error("reviewed Neon API response was not valid JSON");
      }
    }
    if (attempt < attempts) {
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        GET_RETRY_INTERVAL_MS,
      );
    }
  }
  throw new Error("reviewed Neon API command failed without a usable response");
}

export function normalizeNeonOperation(operation) {
  if (
    typeof operation?.id !== "string"
    || operation.project_id !== REVIEWED_NEON_PROJECT_ID
    || (operation.branch_id && operation.branch_id !== REVIEWED_NEON_BRANCH_ID)
    || typeof operation.action !== "string"
    || typeof operation.status !== "string"
  ) {
    throw new Error("Neon password operation did not match the reviewed project and branch");
  }
  return Object.freeze({
    id: operation.id,
    action: operation.action,
    status: operation.status,
  });
}

export function validateNeonOwnerResetResponse(payload) {
  const role = payload?.role;
  if (
    role?.branch_id !== REVIEWED_NEON_BRANCH_ID
    || role.name !== REVIEWED_OWNER_ROLE
    || role.authentication_method !== "password"
    || typeof role.updated_at !== "string"
    || !NEON_OWNER_PASSWORD_PATTERN.test(role.password)
    || !Array.isArray(payload.operations)
    || payload.operations.length === 0
  ) {
    throw new Error("Neon owner reset response did not match the reviewed role shape");
  }
  return Object.freeze({
    password: role.password,
    roleUpdatedAt: new Date(role.updated_at).toISOString(),
    operations: payload.operations.map(normalizeNeonOperation),
  });
}

export function resetReviewedNeonOwnerPassword() {
  return validateNeonOwnerResetResponse(runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}`
      + `/branches/${REVIEWED_NEON_BRANCH_ID}`
      + `/roles/${REVIEWED_OWNER_ROLE}/reset_password`,
    "POST",
  ));
}

export function readReviewedNeonOperation(operationId) {
  if (typeof operationId !== "string" || !/^[A-Za-z0-9-]{8,80}$/.test(operationId)) {
    throw new Error("Neon operation id is not bounded");
  }
  return normalizeNeonOperation(runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/operations/${operationId}`,
  )?.operation);
}

export function readReviewedNeonOwnerRoleMetadata() {
  const role = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}`
      + `/branches/${REVIEWED_NEON_BRANCH_ID}`
      + `/roles/${REVIEWED_OWNER_ROLE}`,
  )?.role;
  if (
    role?.branch_id !== REVIEWED_NEON_BRANCH_ID
    || role.name !== REVIEWED_OWNER_ROLE
    || role.authentication_method !== "password"
    || typeof role.updated_at !== "string"
  ) {
    throw new Error("Neon owner role metadata did not match the reviewed target");
  }
  return Object.freeze({
    branchId: role.branch_id,
    name: role.name,
    authenticationMethod: role.authentication_method,
    updatedAt: new Date(role.updated_at).toISOString(),
  });
}

export function revealReviewedNeonOwnerPassword() {
  const password = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}`
      + `/branches/${REVIEWED_NEON_BRANCH_ID}`
      + `/roles/${REVIEWED_OWNER_ROLE}/reveal_password`,
  )?.password;
  if (!NEON_OWNER_PASSWORD_PATTERN.test(password)) {
    throw new Error("Neon revealed owner password did not match the reviewed shape");
  }
  return password;
}

export function verifyReviewedNeonTarget() {
  const project = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}`)?.project;
  const branch = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${REVIEWED_NEON_BRANCH_ID}`,
  )?.branch;
  const endpoints = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/endpoints`,
  )?.endpoints;
  const endpoint = Array.isArray(endpoints)
    ? endpoints.find((candidate) => candidate?.id === REVIEWED_ENDPOINT_ID)
    : null;
  if (
    project?.id !== REVIEWED_NEON_PROJECT_ID
    || project.org_id !== REVIEWED_NEON_ORG_ID
    || project.region_id !== "azure-westus3"
    || project.store_passwords !== true
    || branch?.id !== REVIEWED_NEON_BRANCH_ID
    || branch.name !== REVIEWED_NEON_BRANCH_NAME
    || branch.primary !== true
    || branch.default !== true
    || endpoint?.branch_id !== REVIEWED_NEON_BRANCH_ID
    || endpoint.region_id !== "azure-westus3"
    || endpoint.type !== "read_write"
    || endpoint.disabled !== false
  ) {
    throw new Error("Neon project, production branch, or endpoint metadata drifted");
  }
  return Object.freeze({
    projectId: project.id,
    orgId: project.org_id,
    branchId: branch.id,
    endpointId: endpoint.id,
  });
}

export function buildNeonOwnerDirectUrl(currentDirectUrl, password) {
  if (!NEON_OWNER_PASSWORD_PATTERN.test(password)) {
    throw new Error("Neon owner password does not match the reviewed shape");
  }
  const before = parseGuardedNeonDatabaseIdentity(currentDirectUrl, "current DIRECT_URL");
  const next = new URL(currentDirectUrl);
  next.password = password;
  const nextUrl = next.toString();
  const after = parseGuardedNeonDatabaseIdentity(nextUrl, "Neon owner DIRECT_URL");
  if (
    JSON.stringify(before) !== JSON.stringify(after)
    || after.endpointId !== REVIEWED_ENDPOINT_ID
    || after.databaseName !== REVIEWED_DATABASE_NAME
    || after.region !== REVIEWED_DATABASE_REGION
    || after.username !== REVIEWED_OWNER_ROLE
    || after.isPooler
  ) {
    throw new Error("Neon owner DIRECT_URL changed the reviewed database identity");
  }
  return nextUrl;
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForReviewedNeonOperations(
  initialOperations,
  readOperation = readReviewedNeonOperation,
  wait = defaultWait,
) {
  let operations = initialOperations;
  for (let attempt = 1; attempt <= OPERATION_ATTEMPTS; attempt += 1) {
    if (operations.some((operation) => ["failed", "error", "cancelled"].includes(operation.status))) {
      throw new Error("Neon owner password operation failed");
    }
    if (operations.every((operation) => ["finished", "skipped"].includes(operation.status))) {
      return operations;
    }
    if (attempt < OPERATION_ATTEMPTS) await wait(OPERATION_INTERVAL_MS);
    operations = await Promise.all(operations.map((operation) => readOperation(operation.id)));
  }
  throw new Error("Neon owner password operations did not finish in the reviewed window");
}

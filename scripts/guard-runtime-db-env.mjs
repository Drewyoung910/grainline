#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDeterministicPostgresEnvironment,
  assertExplicitPostgresConnectionAuthority,
  assertReviewedPostgresConnectionParameters,
  parseCanonicalPostgresDatabaseName,
  parseExactPostgresUrl,
} from "./postgres-url-safety.mjs";

export const REVIEWED_PRODUCTION_RUNTIME_IDENTITY = Object.freeze({
  databaseName: "neondb",
  endpointId: "ep-plain-river-aaqg8gj4",
  region: "westus3.azure",
  role: "grainline_app_runtime",
});

// Disposable provider-runtime proof only. This exact branch, route, test,
// database endpoint, and every branch-scoped variable are deleted after the
// two counted runs. Keep this exception out of the canonical Notification
// branch and fail closed whenever any pinned condition drifts.
export const NOTIFICATION_PROVIDER_PROOF = Object.freeze({
  branch: "codex/rls-notification-provider-proof-2-20260722",
  databaseAliasKey: "RLS_CONTEXT_GATE_DATABASE_URL",
  databaseName: "neondb",
  endpointId: "ep-mute-shape-aahq7xma",
  middlewarePath: "src/middleware.ts",
  publicPath: "/api/internal/rls-context-gate",
  region: "westus3.azure",
  routePath: "src/app/api/internal/rls-context-gate/route.ts",
  runnerPath: "src/lib/notificationRlsProviderGate.ts",
  runtimeRole: "grainline_app_runtime",
  testMarker: "RLS_CONTEXT_GATE_RUNNER_ONLY_TEST",
  testPath: "tests/rls-context-runner-route.test.mjs",
});

const OWNER_ENVIRONMENT_KEY_PATTERNS = Object.freeze([
  /(?:^|_)DIRECT_URL$/,
  /(?:^|_)ADMIN_DATABASE_URL$/,
  /(?:^|_)PROOF_DIRECT_URL$/,
  /^MIGRATION_DB_ROLE$/,
  /^GRANT_AUDIT_DATABASE_URL$/,
]);

export const NOTIFICATION_RLS_DRAFT_URLS = Object.freeze([
  new URL("../docs/rls-drafts/notification-related-user.sql", import.meta.url),
  new URL("../docs/rls-drafts/notification-recipient-access.sql", import.meta.url),
  new URL("../docs/rls-drafts/notification-service-authority.sql", import.meta.url),
]);

function isRegularNonSymlinkFile(filePath) {
  if (!existsSync(filePath)) return false;
  const stat = lstatSync(filePath);
  return stat.isFile() && !stat.isSymbolicLink();
}

export function notificationProviderProofDeploymentIsReviewed(
  env,
  { rootDirectory = process.cwd() } = {},
) {
  const proof = NOTIFICATION_PROVIDER_PROOF;
  const allowedSha = env?.RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA;
  const databaseUrl = env?.DATABASE_URL;
  const aliasUrl = env?.[proof.databaseAliasKey];
  if (
    env?.VERCEL !== "1"
    || env?.VERCEL_ENV !== "preview"
    || env?.VERCEL_GIT_COMMIT_REF !== proof.branch
    || typeof allowedSha !== "string"
    || !/^[0-9a-f]{40}$/.test(allowedSha)
    || env?.VERCEL_GIT_COMMIT_SHA !== allowedSha
    || env?.RLS_CONTEXT_GATE_CONFIRM !== "staging-only"
    || env?.RLS_CONTEXT_GATE_LOCALITY_CONFIRM !== "production-runtime"
    || env?.RLS_CONTEXT_GATE_RUNTIME_ROLE !== proof.runtimeRole
    || env?.RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID !== proof.endpointId
    || env?.RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME !== proof.databaseName
    || env?.RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION !== proof.region
    || typeof databaseUrl !== "string"
    || aliasUrl !== databaseUrl
  ) {
    return false;
  }

  let identity;
  try {
    identity = parseVercelRuntimeDatabaseIdentity(databaseUrl, "DATABASE_URL");
  } catch {
    return false;
  }
  if (
    !identity.isPooler
    || identity.username !== proof.runtimeRole
    || identity.endpointId !== proof.endpointId
    || identity.databaseName !== proof.databaseName
    || identity.region !== proof.region
  ) {
    return false;
  }

  const paths = Object.fromEntries(
    ["middlewarePath", "routePath", "runnerPath", "testPath"].map((key) => [
      key,
      path.join(rootDirectory, proof[key]),
    ]),
  );
  if (Object.values(paths).some((filePath) => !isRegularNonSymlinkFile(filePath))) {
    return false;
  }
  const middleware = readFileSync(paths.middlewarePath, "utf8");
  const route = readFileSync(paths.routePath, "utf8");
  const runner = readFileSync(paths.runnerPath, "utf8");
  const runnerTest = readFileSync(paths.testPath, "utf8");
  return middleware.includes(`"${proof.publicPath}"`)
    && route.includes('process.env.VERCEL_ENV !== "preview"')
    && route.includes("RLS_CONTEXT_GATE_TRIGGER_SECRET")
    && route.includes("RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA")
    && route.includes("runNotificationProviderGate")
    && runner.includes("export async function runNotificationProviderGate")
    && runnerTest.startsWith(`// ${proof.testMarker}\n`);
}

export function assertNoNotificationRlsDraftDeployment(
  env = process.env,
  draftPresent = NOTIFICATION_RLS_DRAFT_URLS.some((draftUrl) => existsSync(draftUrl)),
  options = {},
) {
  if (
    env.VERCEL === "1"
    && draftPresent
    && !notificationProviderProofDeploymentIsReviewed(env, options)
  ) {
    throw new Error(
      "Vercel deployment is barred while the unapplied Notification RLS draft is present",
    );
  }
}

export function privilegedDatabaseEnvironmentKeys(env) {
  return Object.keys(env ?? {})
    .filter((key) => OWNER_ENVIRONMENT_KEY_PATTERNS.some((pattern) => pattern.test(key)))
    .sort((left, right) => left.localeCompare(right));
}

export function unreviewedPostgresUrlEnvironmentKeys(env, options = {}) {
  const reviewedProofAlias = notificationProviderProofDeploymentIsReviewed(env, options)
    ? NOTIFICATION_PROVIDER_PROOF.databaseAliasKey
    : null;
  return Object.entries(env ?? {})
    .filter(([key, value]) => (
      key !== "DATABASE_URL"
      && key !== reviewedProofAlias
      && typeof value === "string"
      && /^postgres(?:ql)?:\/\//i.test(value.trim())
    ))
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right));
}

export function parseVercelRuntimeDatabaseIdentity(value, label = "DATABASE_URL") {
  const parsed = parseExactPostgresUrl(value, label);
  const { username } = assertExplicitPostgresConnectionAuthority(parsed, label);
  assertReviewedPostgresConnectionParameters(parsed, label);
  const databaseName = parseCanonicalPostgresDatabaseName(parsed, label);
  const match = parsed.hostname.toLowerCase().match(
    /^(ep-[a-z0-9-]+?)(-pooler)?\.([a-z0-9-]+)\.([a-z0-9-]+)\.neon\.tech$/,
  );
  if (!match) throw new Error(`${label} must identify one Neon endpoint`);
  return Object.freeze({
    databaseName,
    endpointId: match[1],
    isPooler: Boolean(match[2]),
    port: parsed.port,
    region: `${match[3]}.${match[4]}`,
    username,
  });
}

export function assertVercelRuntimeDatabaseIsolation(env = process.env, options = {}) {
  assertDeterministicPostgresEnvironment(env, "Vercel runtime database isolation");
  if (env.VERCEL !== "1") {
    return Object.freeze({ enforced: false, provider: null, environment: null });
  }
  if (!new Set(["production", "preview", "development"]).has(env.VERCEL_ENV)) {
    throw new Error("VERCEL_ENV must identify a reviewed Vercel environment");
  }

  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `Vercel application builds must not receive privileged database environment keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedPostgresUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env, options);
  if (unreviewedPostgresUrlKeys.length > 0) {
    throw new Error(
      `Vercel application builds must not receive PostgreSQL URLs outside DATABASE_URL: ${unreviewedPostgresUrlKeys.join(", ")}`,
    );
  }

  const databaseUrl = env.DATABASE_URL;
  if (env.VERCEL_ENV !== "production" && !databaseUrl) {
    return Object.freeze({
      enforced: true,
      provider: "vercel",
      environment: env.VERCEL_ENV,
      runtimeDatabaseVerified: false,
    });
  }
  const identity = parseVercelRuntimeDatabaseIdentity(databaseUrl, "DATABASE_URL");
  if (!identity.isPooler) {
    throw new Error("Vercel DATABASE_URL must use a pooled Neon endpoint");
  }
  if (identity.username === "neondb_owner") {
    throw new Error("Vercel DATABASE_URL must not authenticate as the migration owner");
  }

  if (env.VERCEL_ENV === "production") {
    const reviewed = REVIEWED_PRODUCTION_RUNTIME_IDENTITY;
    if (
      env.RUNTIME_DB_ROLE !== reviewed.role
      || identity.username !== reviewed.role
      || identity.endpointId !== reviewed.endpointId
      || identity.region !== reviewed.region
      || identity.databaseName !== reviewed.databaseName
    ) {
      throw new Error("production Vercel DATABASE_URL or RUNTIME_DB_ROLE does not match the reviewed runtime identity");
    }
  }

  return Object.freeze({
    enforced: true,
    provider: "vercel",
    environment: env.VERCEL_ENV,
    runtimeDatabaseVerified: true,
    endpointId: identity.endpointId,
    databaseName: identity.databaseName,
    region: identity.region,
    runtimeRole: identity.username,
  });
}

export function runtimeDatabaseIsolationFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  const rules = [
    [/unapplied Notification RLS draft/, "NOTIFICATION_RLS_DRAFT_PRESENT"],
    [/NODE_TLS_REJECT_UNAUTHORIZED/, "TLS_OVERRIDE"],
    [/PGOPTIONS/, "PGOPTIONS"],
    [/VERCEL_ENV/, "VERCEL_ENV"],
    [/privileged database environment keys/, "PRIVILEGED_DATABASE_KEYS"],
    [/PostgreSQL URLs outside DATABASE_URL/, "ALIASED_DATABASE_URL"],
    [/connection parameters|sslmode=verify-full|channel_binding/, "DATABASE_URL_PARAMETERS"],
    [/non-empty PostgreSQL URL|valid PostgreSQL URL|postgres\/postgresql protocol|explicit database host|explicit port|database path segment|invalid URL encoding/, "DATABASE_URL_SHAPE"],
    [/pooled Neon endpoint/, "DATABASE_URL_NOT_POOLED"],
    [/migration owner/, "DATABASE_URL_OWNER_ROLE"],
    [/reviewed runtime identity/, "PRODUCTION_RUNTIME_IDENTITY"],
  ];
  return rules.find(([pattern]) => pattern.test(message))?.[1] ?? "UNCLASSIFIED";
}

export function runtimeDatabaseIsolationFailureDetail(code, env = process.env) {
  if (code === "PRIVILEGED_DATABASE_KEYS") {
    return privilegedDatabaseEnvironmentKeys(env).join(",");
  }
  if (code === "ALIASED_DATABASE_URL") {
    return unreviewedPostgresUrlEnvironmentKeys(env).join(",");
  }
  return "";
}

function main() {
  try {
    assertNoNotificationRlsDraftDeployment(process.env);
    const result = assertVercelRuntimeDatabaseIsolation(process.env);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = runtimeDatabaseIsolationFailureCode(error);
    const detail = runtimeDatabaseIsolationFailureDetail(code, process.env);
    process.stderr.write(
      `Vercel runtime database isolation guard failed [${code}]${detail ? ` keys=${detail}` : ""}.\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

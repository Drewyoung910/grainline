#!/usr/bin/env node
import { existsSync } from "node:fs";
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

const OWNER_ENVIRONMENT_KEY_PATTERNS = Object.freeze([
  /(?:^|_)DIRECT_URL$/,
  /(?:^|_)ADMIN_DATABASE_URL$/,
  /(?:^|_)PROOF_DIRECT_URL$/,
  /^MIGRATION_DB_ROLE$/,
  /^GRANT_AUDIT_DATABASE_URL$/,
]);

export const NOTIFICATION_RLS_DRAFT_URL = new URL(
  "../docs/rls-drafts/notification-related-user.sql",
  import.meta.url,
);

export function assertNoNotificationRlsDraftDeployment(
  env = process.env,
  draftPresent = existsSync(NOTIFICATION_RLS_DRAFT_URL),
) {
  if (env.VERCEL === "1" && draftPresent) {
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

export function assertVercelRuntimeDatabaseIsolation(env = process.env) {
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

function main() {
  try {
    assertNoNotificationRlsDraftDeployment(process.env);
    const result = assertVercelRuntimeDatabaseIsolation(process.env);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("Vercel runtime database isolation guard failed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

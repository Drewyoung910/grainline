#!/usr/bin/env node
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

export const REVIEWED_PRODUCTION_STAFF_READ_IDENTITY = Object.freeze({
  ...REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
  role: "grainline_staff_read_runtime",
});

export const ORDER_STAFF_READ_DATABASE_ENV = "ORDER_STAFF_READ_DATABASE_URL";

const OWNER_ENVIRONMENT_KEY_PATTERNS = Object.freeze([
  /(?:^|_)DIRECT_URL$/,
  /(?:^|_)ADMIN_DATABASE_URL$/,
  /(?:^|_)PROOF_DIRECT_URL$/,
  /^MIGRATION_DB_ROLE$/,
  /^GRANT_AUDIT_DATABASE_URL$/,
]);

export function privilegedDatabaseEnvironmentKeys(env) {
  return Object.keys(env ?? {})
    .filter((key) => OWNER_ENVIRONMENT_KEY_PATTERNS.some((pattern) => pattern.test(key)))
    .sort((left, right) => left.localeCompare(right));
}

export function unreviewedPostgresUrlEnvironmentKeys(env) {
  return Object.entries(env ?? {})
    .filter(([key, value]) => (
      key !== "DATABASE_URL"
      && key !== ORDER_STAFF_READ_DATABASE_ENV
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

export function assertVercelRuntimeDatabaseIsolation(
  env = process.env,
  { requireOrderStaffReadDatabase = false } = {},
) {
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
  const unreviewedPostgresUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedPostgresUrlKeys.length > 0) {
    throw new Error(
      `Vercel application builds must not receive PostgreSQL URLs outside DATABASE_URL: ${unreviewedPostgresUrlKeys.join(", ")}`,
    );
  }

  const databaseUrl = env.DATABASE_URL;
  const staffReadDatabaseUrl = env[ORDER_STAFF_READ_DATABASE_ENV];
  if (env.VERCEL_ENV !== "production" && !databaseUrl) {
    if (staffReadDatabaseUrl) {
      throw new Error(
        `Vercel ${ORDER_STAFF_READ_DATABASE_ENV} must be absent when DATABASE_URL is absent`,
      );
    }
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

  let staffReadIdentity = null;
  if (staffReadDatabaseUrl) {
    staffReadIdentity = parseVercelRuntimeDatabaseIdentity(
      staffReadDatabaseUrl,
      ORDER_STAFF_READ_DATABASE_ENV,
    );
    if (!staffReadIdentity.isPooler) {
      throw new Error(`Vercel ${ORDER_STAFF_READ_DATABASE_ENV} must use a pooled Neon endpoint`);
    }
    if (staffReadIdentity.username !== REVIEWED_PRODUCTION_STAFF_READ_IDENTITY.role) {
      throw new Error(
        `Vercel ${ORDER_STAFF_READ_DATABASE_ENV} must authenticate as the reviewed staff read role`,
      );
    }
    if (
      staffReadIdentity.endpointId !== identity.endpointId
      || staffReadIdentity.region !== identity.region
      || staffReadIdentity.databaseName !== identity.databaseName
    ) {
      throw new Error(
        `Vercel ${ORDER_STAFF_READ_DATABASE_ENV} must identify the same reviewed database as DATABASE_URL`,
      );
    }
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
    if (requireOrderStaffReadDatabase && !staffReadIdentity) {
      throw new Error(
        `production Vercel ${ORDER_STAFF_READ_DATABASE_ENV} is required for staff Order reads`,
      );
    }
    const reviewedStaff = REVIEWED_PRODUCTION_STAFF_READ_IDENTITY;
    if (
      staffReadIdentity
      && (
      staffReadIdentity.username !== reviewedStaff.role
      || staffReadIdentity.endpointId !== reviewedStaff.endpointId
      || staffReadIdentity.region !== reviewedStaff.region
      || staffReadIdentity.databaseName !== reviewedStaff.databaseName
      )
    ) {
      throw new Error(
        `production Vercel ${ORDER_STAFF_READ_DATABASE_ENV} does not match the reviewed staff read identity`,
      );
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
    staffReadRole: staffReadIdentity?.username ?? null,
  });
}

export function runtimeDatabaseIsolationFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  const rules = [
    [/NODE_TLS_REJECT_UNAUTHORIZED/, "TLS_OVERRIDE"],
    [/PGOPTIONS/, "PGOPTIONS"],
    [/VERCEL_ENV/, "VERCEL_ENV"],
    [/privileged database environment keys/, "PRIVILEGED_DATABASE_KEYS"],
    [/PostgreSQL URLs outside DATABASE_URL/, "ALIASED_DATABASE_URL"],
    [/ORDER_STAFF_READ_DATABASE_URL.*non-empty PostgreSQL URL|ORDER_STAFF_READ_DATABASE_URL.*valid PostgreSQL URL|ORDER_STAFF_READ_DATABASE_URL.*postgres\/postgresql protocol|ORDER_STAFF_READ_DATABASE_URL.*explicit database host|ORDER_STAFF_READ_DATABASE_URL.*explicit port|ORDER_STAFF_READ_DATABASE_URL.*database path segment|ORDER_STAFF_READ_DATABASE_URL.*invalid URL encoding/, "STAFF_DATABASE_URL_SHAPE"],
    [/ORDER_STAFF_READ_DATABASE_URL.*pooled Neon endpoint/, "STAFF_DATABASE_URL_NOT_POOLED"],
    [/ORDER_STAFF_READ_DATABASE_URL.*reviewed staff read role|ORDER_STAFF_READ_DATABASE_URL.*reviewed database|ORDER_STAFF_READ_DATABASE_URL.*reviewed staff read identity|ORDER_STAFF_READ_DATABASE_URL.*required for staff Order reads|ORDER_STAFF_READ_DATABASE_URL.*absent when DATABASE_URL is absent/, "STAFF_DATABASE_IDENTITY"],
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
    const result = assertVercelRuntimeDatabaseIsolation(process.env, {
      requireOrderStaffReadDatabase: true,
    });
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

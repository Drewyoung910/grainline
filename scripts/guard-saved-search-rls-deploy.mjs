import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  assertDeterministicPostgresEnvironment,
  assertExplicitPostgresConnectionAuthority,
  assertReviewedPostgresConnectionParameters,
  parseCanonicalPostgresDatabaseName,
} from "./postgres-url-safety.mjs";

export const SAVED_SEARCH_RLS_DEPLOY_PHASE_ENV =
  "SAVED_SEARCH_RLS_DEPLOY_PHASE";
export const SAVED_SEARCH_RPC_MIGRATION =
  "20260717024500_add_saved_search_owner_rpcs";
export const SAVED_SEARCH_RPC_HARDENING_MIGRATION =
  "20260717025000_harden_saved_search_owner_rpc_projection";
export const SAVED_SEARCH_RLS_MIGRATION =
  "20260717030000_enable_saved_search_rls";
export const RELEASE_ZERO_MIGRATION_TREE_SHA256 =
  "3e9111525735043266cf6f18b790641ad3103126804836f4a7cccd8e5e29ff29";
export const PHASE_A_MIGRATION_TREE_SHA256 =
  "f6cde6b6a64c3876ae954b5683af0ec47d9358e356657fee34de11ec5f9005c0";
export const PRISMA_CONFIG_PATH = "prisma.config.ts";
export const REVIEWED_PRISMA_CONFIG_SHA256 =
  "946211cec942f725ae24ac239cd648b56f4809cf30cb8fda530346d0f593526e";
export const REVIEWED_PRODUCTION_MIDDLEWARE_SHA256 =
  "03e568d5ff28b8d29284be018170bbe8da0f0ab99b8cab036d7466af5cdefb1b";
export const RLS_CONTEXT_GATE_ROUTE_DIRECTORY =
  "src/app/api/internal/rls-context-gate";
export const RLS_CONTEXT_GATE_ROUTE_PATH =
  `${RLS_CONTEXT_GATE_ROUTE_DIRECTORY}/route.ts`;
export const RLS_CONTEXT_GATE_PUBLIC_PATH =
  "/api/internal/rls-context-gate";
export const RLS_CONTEXT_GATE_RUNNER_TEST_PATH =
  "tests/rls-context-runner-route.test.mjs";
export const RLS_CONTEXT_GATE_RUNNER_TEST_MARKER =
  "RLS_CONTEXT_GATE_RUNNER_ONLY_TEST";
export const REVIEWED_RUNTIME_DB_ROLE = "grainline_app_runtime";
export const REVIEWED_MIGRATION_DB_ROLE = "neondb_owner";

const RELEASE_ZERO_PHASE = "release-0";
const REVIEWED_PHASE_A = "phase-a-reviewed";
const APP_SOURCE_ROOTS = ["src/app", "app", "src/pages", "pages"];
const TEST_SOURCE_ROOTS = ["tests"];
const TEST_SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const CONTEXT_GATE_PATH_MARKER = "rls-context-gate";
const CONTEXT_GATE_SOURCE_MARKERS = [
  RLS_CONTEXT_GATE_PUBLIC_PATH,
  "RLS_CONTEXT_GATE_TRIGGER_SECRET",
  "RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA",
  "claimProviderRuntimeRunSlot",
  "rls-context-acceptance-gate.mjs",
];

export function computeTextSha256(source) {
  if (typeof source !== "string") {
    throw new TypeError("source must be a string");
  }
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function computeFileSha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function constantStringValue(node, bindings, seen = new Set()) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isNonNullExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isSatisfiesExpression(node)
  ) {
    return constantStringValue(node.expression, bindings, seen);
  }
  if (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = constantStringValue(node.left, bindings, seen);
    const right = constantStringValue(node.right, bindings, seen);
    return left === null || right === null ? null : `${left}${right}`;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = constantStringValue(span.expression, bindings, seen);
      if (expression === null) return null;
      value += `${expression}${span.literal.text}`;
    }
    return value;
  }
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return null;
    const initializer = bindings.get(node.text);
    if (!initializer) return null;
    const nextSeen = new Set(seen);
    nextSeen.add(node.text);
    return constantStringValue(initializer, bindings, nextSeen);
  }
  return null;
}

export function middlewareContainsContextGateExemption(middlewareSource) {
  if (typeof middlewareSource !== "string") {
    throw new TypeError("middlewareSource must be a string");
  }

  const sourceFile = ts.createSourceFile(
    "middleware.ts",
    middlewareSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error("could not parse middleware while checking the temporary RLS context-gate exemption");
  }

  const bindings = new Map();
  const collectBindings = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
    ) {
      bindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(sourceFile);

  let found = false;
  const inspect = (node) => {
    if (found) return;
    const value = constantStringValue(node, bindings);
    if (
      typeof value === "string"
      && value.includes(RLS_CONTEXT_GATE_PUBLIC_PATH)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
  return found;
}

export function findContextGateAppArtifacts(rootDirectory = process.cwd()) {
  const artifacts = new Set();
  const visitedDirectories = new Set();

  const inspectFile = (physicalPath, logicalPath) => {
    const source = readFileSync(physicalPath, "utf8");
    if (CONTEXT_GATE_SOURCE_MARKERS.some((marker) => source.includes(marker))) {
      artifacts.add(logicalPath);
    }
  };

  const inspectEntry = (physicalPath, logicalPath) => {
    if (logicalPath.toLowerCase().includes(CONTEXT_GATE_PATH_MARKER)) {
      artifacts.add(logicalPath);
    }

    const linkStat = lstatSync(physicalPath);
    const resolvedPath = linkStat.isSymbolicLink()
      ? realpathSync(physicalPath)
      : physicalPath;
    const resolvedStat = linkStat.isSymbolicLink()
      ? statSync(resolvedPath)
      : linkStat;

    if (resolvedStat.isFile()) {
      inspectFile(resolvedPath, logicalPath);
      return;
    }
    if (!resolvedStat.isDirectory()) return;

    const realDirectory = realpathSync(resolvedPath);
    if (visitedDirectories.has(realDirectory)) return;
    visitedDirectories.add(realDirectory);

    for (const entry of readdirSync(realDirectory, { withFileTypes: true })) {
      inspectEntry(
        path.join(realDirectory, entry.name),
        path.posix.join(logicalPath, entry.name),
      );
    }
  };

  for (const sourceRoot of APP_SOURCE_ROOTS) {
    const absoluteSourceRoot = path.resolve(rootDirectory, sourceRoot);
    if (!existsSync(absoluteSourceRoot)) continue;
    inspectEntry(absoluteSourceRoot, sourceRoot);
  }

  return [...artifacts].sort((a, b) => a.localeCompare(b));
}

export function contextGateRouteArtifactExists(rootDirectory = process.cwd()) {
  return findContextGateAppArtifacts(rootDirectory).length > 0;
}

export function findContextGateRunnerTestArtifacts(rootDirectory = process.cwd()) {
  const artifacts = new Set();

  const inspectEntry = (physicalPath, logicalPath) => {
    const entryStat = lstatSync(physicalPath);
    if (entryStat.isSymbolicLink()) {
      // Production test artifacts do not require symlinks. Treat every link as
      // suspicious instead of following a target that can disappear or escape
      // the reviewed source tree between guard and build.
      artifacts.add(logicalPath);
      return;
    }
    if (entryStat.isDirectory()) {
      for (const entry of readdirSync(physicalPath, { withFileTypes: true })) {
        inspectEntry(
          path.join(physicalPath, entry.name),
          path.posix.join(logicalPath, entry.name),
        );
      }
      return;
    }
    if (!entryStat.isFile()) return;

    if (logicalPath === RLS_CONTEXT_GATE_RUNNER_TEST_PATH) {
      artifacts.add(logicalPath);
      return;
    }
    if (!TEST_SOURCE_EXTENSIONS.has(path.extname(logicalPath).toLowerCase())) {
      return;
    }

    const source = readFileSync(physicalPath, "utf8");
    const containsRunnerRoute =
      source.includes(RLS_CONTEXT_GATE_ROUTE_PATH)
      || source.includes(RLS_CONTEXT_GATE_PUBLIC_PATH);
    if (
      containsRunnerRoute
      && source.includes(RLS_CONTEXT_GATE_RUNNER_TEST_MARKER)
    ) {
      artifacts.add(logicalPath);
    }
  };

  for (const sourceRoot of TEST_SOURCE_ROOTS) {
    const absoluteSourceRoot = path.resolve(rootDirectory, sourceRoot);
    if (!existsSync(absoluteSourceRoot)) continue;
    inspectEntry(absoluteSourceRoot, sourceRoot);
  }

  return [...artifacts].sort((a, b) => a.localeCompare(b));
}

export function contextGateRunnerTestExists(rootDirectory = process.cwd()) {
  return findContextGateRunnerTestArtifacts(rootDirectory).length > 0;
}

export function computeMigrationTreeSha256(migrationDirectory, migrationNames) {
  if (!Array.isArray(migrationNames)) {
    throw new TypeError("migrationNames must be an array");
  }
  const hash = createHash("sha256");
  for (const migrationName of [...migrationNames].sort()) {
    const migrationPath = path.join(migrationDirectory, migrationName, "migration.sql");
    if (!existsSync(migrationPath)) {
      throw new Error(`reviewed migration ${migrationName} is missing migration.sql`);
    }
    hash.update(migrationName, "utf8");
    hash.update("\0", "utf8");
    hash.update(readFileSync(migrationPath));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

function assertReviewedMigrationTree(phase, migrationTreeSha256) {
  const expected = phase === RELEASE_ZERO_PHASE
    ? RELEASE_ZERO_MIGRATION_TREE_SHA256
    : PHASE_A_MIGRATION_TREE_SHA256;
  if (migrationTreeSha256 !== expected) {
    throw new Error(
      `${phase} migration tree fingerprint changed; review every added, removed, renamed, or modified migration before updating the temporary SavedSearch deploy guard`,
    );
  }
}

function assertReviewedPrismaMigrationConfig(prismaConfigSha256) {
  if (prismaConfigSha256 !== REVIEWED_PRISMA_CONFIG_SHA256) {
    throw new Error(
      `${PRISMA_CONFIG_PATH} fingerprint changed; the effective Prisma migration directory could have been redirected, so review the config before updating the temporary SavedSearch deploy guard`,
    );
  }
}

export function parseGuardedNeonDatabaseIdentity(value, label) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty PostgreSQL URL without surrounding whitespace`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error(`${label} must use the postgres/postgresql protocol`);
  }
  const { username } = assertExplicitPostgresConnectionAuthority(parsed, label);
  assertReviewedPostgresConnectionParameters(parsed, label);
  const databaseName = parseCanonicalPostgresDatabaseName(parsed, label);

  const match = parsed.hostname.toLowerCase().match(
    /^(ep-[a-z0-9-]+?)(-pooler)?\.([a-z0-9-]+)\.([a-z0-9-]+)\.neon\.tech$/,
  );
  if (!match) {
    throw new Error(`${label} must identify one reviewed Neon endpoint`);
  }

  return Object.freeze({
    databaseName,
    endpointId: match[1],
    isPooler: Boolean(match[2]),
    port: parsed.port || "5432",
    region: `${match[3]}.${match[4]}`,
    username,
  });
}

export function assertGuardedDeployEnvironment(env) {
  assertDeterministicPostgresEnvironment(env, "guarded production migration");
  const runtimeUrl = env?.DATABASE_URL;
  const directUrl = env?.DIRECT_URL;
  const runtimeRole = env?.RUNTIME_DB_ROLE;
  const migrationRole = env?.MIGRATION_DB_ROLE;
  const auditUrl = env?.GRANT_AUDIT_DATABASE_URL;
  const missing = [];

  if (!runtimeUrl?.trim()) missing.push("DATABASE_URL");
  if (!directUrl) missing.push("DIRECT_URL");
  if (!runtimeRole) missing.push("RUNTIME_DB_ROLE");
  if (!migrationRole) missing.push("MIGRATION_DB_ROLE");
  if (missing.length > 0) {
    throw new Error(
      `guarded production migration requires ${missing.join(", ")} before any migration runs`,
    );
  }
  if (runtimeRole !== runtimeRole.trim() || migrationRole !== migrationRole.trim()) {
    throw new Error(
      "RUNTIME_DB_ROLE and MIGRATION_DB_ROLE must not contain surrounding whitespace before any migration runs",
    );
  }
  if (
    runtimeRole !== REVIEWED_RUNTIME_DB_ROLE
    || migrationRole !== REVIEWED_MIGRATION_DB_ROLE
  ) {
    throw new Error(
      `guarded rollout requires the reviewed roles ${REVIEWED_RUNTIME_DB_ROLE} and ${REVIEWED_MIGRATION_DB_ROLE} before any migration runs`,
    );
  }
  if (runtimeRole === migrationRole) {
    throw new Error(
      "RUNTIME_DB_ROLE and MIGRATION_DB_ROLE must be distinct before any migration runs",
    );
  }
  if (auditUrl && (auditUrl !== auditUrl.trim() || auditUrl !== directUrl)) {
    throw new Error(
      "GRANT_AUDIT_DATABASE_URL must be absent or exactly match DIRECT_URL before any migration runs",
    );
  }

  const runtimeIdentity = parseGuardedNeonDatabaseIdentity(
    runtimeUrl,
    "DATABASE_URL",
  );
  const migrationIdentity = parseGuardedNeonDatabaseIdentity(
    directUrl,
    "DIRECT_URL",
  );
  if (!runtimeIdentity.isPooler) {
    throw new Error("DATABASE_URL must use the pooled Neon endpoint before any migration runs");
  }
  if (migrationIdentity.isPooler) {
    throw new Error("DIRECT_URL must use the direct Neon endpoint before any migration runs");
  }
  if (runtimeIdentity.username !== runtimeRole) {
    throw new Error("DATABASE_URL username must match RUNTIME_DB_ROLE before any migration runs");
  }
  if (migrationIdentity.username !== migrationRole) {
    throw new Error("DIRECT_URL username must match MIGRATION_DB_ROLE before any migration runs");
  }
  if (
    runtimeIdentity.endpointId !== migrationIdentity.endpointId
    || runtimeIdentity.region !== migrationIdentity.region
    || runtimeIdentity.port !== migrationIdentity.port
    || runtimeIdentity.databaseName !== migrationIdentity.databaseName
  ) {
    throw new Error(
      "DATABASE_URL and DIRECT_URL must target the same Neon endpoint, region, port, and database before any migration runs",
    );
  }
}

function assertProductionArtifactExcludesContextGate({
  phase,
  contextGateRouteExists,
  contextGateRunnerTestExists: runnerTestExists,
  middlewareSource,
}) {
  if (typeof contextGateRouteExists !== "boolean") {
    throw new TypeError("contextGateRouteExists must be a boolean");
  }
  if (typeof middlewareSource !== "string") {
    throw new TypeError("middlewareSource must be a string");
  }
  if (typeof runnerTestExists !== "boolean") {
    throw new TypeError("contextGateRunnerTestExists must be a boolean");
  }

  const hasMiddlewareExemption =
    middlewareContainsContextGateExemption(middlewareSource);
  const middlewareFingerprintChanged =
    computeTextSha256(middlewareSource)
      !== REVIEWED_PRODUCTION_MIDDLEWARE_SHA256;
  const violations = [];

  if (contextGateRouteExists) {
    violations.push(
      `temporary context-gate app artifact (including ${RLS_CONTEXT_GATE_ROUTE_PATH})`,
    );
  }
  if (runnerTestExists) {
    violations.push(
      `runner-only test ${RLS_CONTEXT_GATE_RUNNER_TEST_PATH}`,
    );
  }
  if (hasMiddlewareExemption) {
    violations.push(
      `middleware exemption for ${RLS_CONTEXT_GATE_PUBLIC_PATH}`,
    );
  }
  if (middlewareFingerprintChanged) {
    violations.push("reviewed production middleware fingerprint changed");
  }

  if (violations.length > 0) {
    throw new Error(
      `${phase} production artifact must exclude the temporary RLS context gate; found ${violations.join(" and ")}`,
    );
  }
}

function assertNoLaterMigration(migrationNames, reviewedLatestMigration, phase) {
  const laterMigrations = migrationNames
    .filter((name) => name.localeCompare(reviewedLatestMigration) > 0)
    .sort((a, b) => a.localeCompare(b));
  if (laterMigrations.length > 0) {
    throw new Error(
      `${phase} requires ${reviewedLatestMigration} to remain the latest migration; review or retire the temporary SavedSearch deploy guard before deploying ${laterMigrations.join(", ")}`,
    );
  }
}

export function validateSavedSearchRlsDeployShape({
  phase,
  migrationNames,
  migrationTreeSha256,
  prismaConfigSha256,
  contextGateRouteExists,
  contextGateRunnerTestExists: runnerTestExists,
  middlewareSource,
}) {
  if (!Array.isArray(migrationNames)) {
    throw new TypeError("migrationNames must be an array");
  }

  const migrations = new Set(migrationNames);
  const hasRpcMigration = migrations.has(SAVED_SEARCH_RPC_MIGRATION);
  const hasRpcHardeningMigration = migrations.has(
    SAVED_SEARCH_RPC_HARDENING_MIGRATION,
  );
  const hasRlsMigration = migrations.has(SAVED_SEARCH_RLS_MIGRATION);

  if (phase === RELEASE_ZERO_PHASE) {
    if (!hasRpcMigration || !hasRpcHardeningMigration || hasRlsMigration) {
      throw new Error(
        `${RELEASE_ZERO_PHASE} requires ${SAVED_SEARCH_RPC_MIGRATION} and ${SAVED_SEARCH_RPC_HARDENING_MIGRATION} to exist and ${SAVED_SEARCH_RLS_MIGRATION} to be absent`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      SAVED_SEARCH_RPC_HARDENING_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
    };
  }

  if (phase === REVIEWED_PHASE_A) {
    if (!hasRpcMigration || !hasRpcHardeningMigration || !hasRlsMigration) {
      throw new Error(
        `${REVIEWED_PHASE_A} requires all three SavedSearch rollout migrations to exist`,
      );
    }

    assertNoLaterMigration(migrationNames, SAVED_SEARCH_RLS_MIGRATION, phase);
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
    };
  }

  const received = phase === undefined || phase === "" ? "missing" : phase;
  throw new Error(
    `${SAVED_SEARCH_RLS_DEPLOY_PHASE_ENV} is ${received}; expected ${RELEASE_ZERO_PHASE} or ${REVIEWED_PHASE_A}`,
  );
}

export function validateCurrentSavedSearchRlsDeployShape({
  phase,
  rootDirectory = process.cwd(),
} = {}) {
  const migrationDirectory = path.resolve(rootDirectory, "prisma/migrations");
  const prismaConfigPath = path.resolve(rootDirectory, PRISMA_CONFIG_PATH);
  const middlewarePath = path.resolve(rootDirectory, "src/middleware.ts");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  return validateSavedSearchRlsDeployShape({
    phase,
    migrationNames,
    migrationTreeSha256: computeMigrationTreeSha256(
      migrationDirectory,
      migrationNames,
    ),
    prismaConfigSha256: computeFileSha256(prismaConfigPath),
    contextGateRouteExists: contextGateRouteArtifactExists(rootDirectory),
    contextGateRunnerTestExists: contextGateRunnerTestExists(rootDirectory),
    middlewareSource: readFileSync(middlewarePath, "utf8"),
  });
}

function runDeployGuard() {
  assertGuardedDeployEnvironment(process.env);
  const result = validateCurrentSavedSearchRlsDeployShape({
    phase: process.env[SAVED_SEARCH_RLS_DEPLOY_PHASE_ENV],
  });

  process.stdout.write(
    `SavedSearch RLS deploy guard passed for ${result.phase}.\n`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    runDeployGuard();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`SavedSearch RLS deploy guard failed: ${message}\n`);
    process.exitCode = 1;
  }
}

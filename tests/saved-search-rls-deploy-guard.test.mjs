import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  PHASE_A_MIGRATION_TREE_SHA256,
  PHASE_B_MIGRATION_TREE_SHA256,
  PRISMA_CONFIG_PATH,
  RELEASE_ZERO_MIGRATION_TREE_SHA256,
  REVIEWED_PRISMA_CONFIG_SHA256,
  REVIEWED_PRODUCTION_MIDDLEWARE_SHA256,
  REVIEWED_MIGRATION_DB_ROLE,
  REVIEWED_RUNTIME_DB_ROLE,
  SAVED_SEARCH_RLS_MIGRATION,
  SAVED_SEARCH_FORCE_RLS_MIGRATION,
  SAVED_SEARCH_RPC_HARDENING_MIGRATION,
  SAVED_SEARCH_RPC_MIGRATION,
  RLS_CONTEXT_GATE_PUBLIC_PATH,
  RLS_CONTEXT_GATE_ROUTE_PATH,
  RLS_CONTEXT_GATE_RUNNER_TEST_MARKER,
  RLS_CONTEXT_GATE_RUNNER_TEST_PATH,
  assertGuardedDeployEnvironment,
  computeFileSha256,
  computeMigrationTreeSha256,
  computeTextSha256,
  contextGateRouteArtifactExists,
  contextGateRunnerTestExists,
  findContextGateAppArtifacts,
  findContextGateRunnerTestArtifacts,
  middlewareContainsContextGateExemption,
  parseGuardedNeonDatabaseIdentity,
  validateSavedSearchRlsDeployShape,
} from "../scripts/guard-saved-search-rls-deploy.mjs";

const RELEASE_ZERO = "release-0";
const REVIEWED_PHASE_A = "phase-a-reviewed";
const REVIEWED_PHASE_B = "phase-b-reviewed";
const PREVIEW_MIDDLEWARE_EXEMPTION_LINE =
  `  "${RLS_CONTEXT_GATE_PUBLIC_PATH}",   // Preview-only, token-protected RLS acceptance runner\n`;
const CURRENT_MIDDLEWARE_SOURCE = readFileSync("src/middleware.ts", "utf8");
const middlewareExemptionParts =
  CURRENT_MIDDLEWARE_SOURCE.split(PREVIEW_MIDDLEWARE_EXEMPTION_LINE);

assert.ok(
  middlewareExemptionParts.length === 1
    || middlewareExemptionParts.length === 2,
  "the reviewed Preview-only middleware exemption line must occur at most once",
);

const REVIEWED_PRODUCTION_MIDDLEWARE_SOURCE =
  CURRENT_MIDDLEWARE_SOURCE.replace(PREVIEW_MIDDLEWARE_EXEMPTION_LINE, "");

assert.equal(
  computeTextSha256(REVIEWED_PRODUCTION_MIDDLEWARE_SOURCE),
  REVIEWED_PRODUCTION_MIDDLEWARE_SHA256,
  "the reviewed production middleware fingerprint must match the Preview source with only the exact exemption removed",
);
assert.equal(
  computeFileSha256(PRISMA_CONFIG_PATH),
  REVIEWED_PRISMA_CONFIG_SHA256,
  "the reviewed Prisma config fingerprint must match the checked-in config",
);

function validate(
  phase,
  migrationNames,
  {
    contextGateRouteExists = false,
    contextGateRunnerTestExists = false,
    migrationTreeSha256 = {
      [RELEASE_ZERO]: RELEASE_ZERO_MIGRATION_TREE_SHA256,
      [REVIEWED_PHASE_A]: PHASE_A_MIGRATION_TREE_SHA256,
      [REVIEWED_PHASE_B]: PHASE_B_MIGRATION_TREE_SHA256,
    }[phase],
    middlewareSource = REVIEWED_PRODUCTION_MIDDLEWARE_SOURCE,
    prismaConfigSha256 = REVIEWED_PRISMA_CONFIG_SHA256,
  } = {},
) {
  return validateSavedSearchRlsDeployShape({
    phase,
    migrationNames,
    migrationTreeSha256,
    prismaConfigSha256,
    contextGateRouteExists,
    contextGateRunnerTestExists,
    middlewareSource,
  });
}

const CURRENT_MIGRATIONS = readdirSync("prisma/migrations", {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const RELEASE_ZERO_MIGRATIONS = CURRENT_MIGRATIONS
  .filter((name) => ![
    SAVED_SEARCH_RLS_MIGRATION,
    SAVED_SEARCH_FORCE_RLS_MIGRATION,
  ].includes(name))
  .sort((a, b) => a.localeCompare(b));
const REVIEWED_PHASE_A_MIGRATIONS = [
  ...RELEASE_ZERO_MIGRATIONS,
  SAVED_SEARCH_RLS_MIGRATION,
].sort((a, b) => a.localeCompare(b));
const REVIEWED_PHASE_B_MIGRATIONS = [
  ...REVIEWED_PHASE_A_MIGRATIONS,
  SAVED_SEARCH_FORCE_RLS_MIGRATION,
].sort((a, b) => a.localeCompare(b));

function migrationsFor(phase) {
  return {
    [RELEASE_ZERO]: RELEASE_ZERO_MIGRATIONS,
    [REVIEWED_PHASE_A]: REVIEWED_PHASE_A_MIGRATIONS,
    [REVIEWED_PHASE_B]: REVIEWED_PHASE_B_MIGRATIONS,
  }[phase];
}

describe("SavedSearch RLS production deploy guard", () => {
  it("rejects missing or drifting database audit identity before migrations run", () => {
    const runtimeUrl =
      `postgresql://${REVIEWED_RUNTIME_DB_ROLE}:runtime-secret@ep-reviewed-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require`;
    const directUrl =
      `postgresql://${REVIEWED_MIGRATION_DB_ROLE}:owner-secret@ep-reviewed.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require`;
    const valid = {
      DATABASE_URL: runtimeUrl,
      DIRECT_URL: directUrl,
      RUNTIME_DB_ROLE: REVIEWED_RUNTIME_DB_ROLE,
      MIGRATION_DB_ROLE: REVIEWED_MIGRATION_DB_ROLE,
    };

    assert.doesNotThrow(() => assertGuardedDeployEnvironment(valid));
    assert.doesNotThrow(() => assertGuardedDeployEnvironment({
      ...valid,
      GRANT_AUDIT_DATABASE_URL: directUrl,
    }));

    for (const key of ["DATABASE_URL", "DIRECT_URL", "RUNTIME_DB_ROLE", "MIGRATION_DB_ROLE"]) {
      const invalid = { ...valid, [key]: "" };
      assert.throws(
        () => assertGuardedDeployEnvironment(invalid),
        (error) => {
          assert.match(error.message, new RegExp(key));
          assert.match(error.message, /before any migration runs/);
          assert.doesNotMatch(error.message, /secret|postgresql:/);
          return true;
        },
      );
    }

    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        RUNTIME_DB_ROLE: ` ${REVIEWED_RUNTIME_DB_ROLE}`,
      }),
      /must not contain surrounding whitespace before any migration runs/,
    );
    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        MIGRATION_DB_ROLE: "unreviewed_owner",
      }),
      /requires the reviewed roles.*before any migration runs/,
    );
    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        GRANT_AUDIT_DATABASE_URL:
          "postgresql://other-owner:other-secret@other.example.test/grainline",
      }),
      (error) => {
        assert.match(error.message, /must be absent or exactly match DIRECT_URL/);
        assert.match(error.message, /before any migration runs/);
        assert.doesNotMatch(error.message, /secret|postgresql:|other\.example/);
        return true;
      },
    );

    assert.deepEqual(parseGuardedNeonDatabaseIdentity(runtimeUrl, "runtime"), {
      databaseName: "neondb",
      endpointId: "ep-reviewed",
      isPooler: true,
      port: "5432",
      region: "westus3.azure",
      username: REVIEWED_RUNTIME_DB_ROLE,
    });
    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        DATABASE_URL: runtimeUrl.replace("ep-reviewed-pooler", "ep-other-pooler"),
      }),
      /must target the same Neon endpoint, region, port, and database/,
    );
    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        DIRECT_URL: directUrl.replace("neondb?", "otherdb?"),
      }),
      /must target the same Neon endpoint, region, port, and database/,
    );
    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        DATABASE_URL: runtimeUrl.replace("-pooler", ""),
      }),
      /DATABASE_URL must use the pooled Neon endpoint/,
    );
    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        DIRECT_URL: directUrl.replace("ep-reviewed.", "ep-reviewed-pooler."),
      }),
      /DIRECT_URL must use the direct Neon endpoint/,
    );
    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        DIRECT_URL: directUrl.replace(REVIEWED_MIGRATION_DB_ROLE, "wrong_owner"),
      }),
      /DIRECT_URL username must match MIGRATION_DB_ROLE/,
    );

    for (const parameter of [
      "host=evil.example",
      "hostaddr=203.0.113.1",
      "user=other_runtime",
      "password=other-secret",
      "port=6543",
      "database=otherdb",
      "dbname=otherdb",
      "service=other-service",
      "options=-c%20app.user_id%3Dforeign",
      "ssl=true",
      "sslcert=%2Ftmp%2Funreviewed-cert",
      "sslkey=%2Ftmp%2Funreviewed-key",
      "sslrootcert=%2Ftmp%2Funreviewed-ca",
      "uselibpqcompat=true",
    ]) {
      assert.throws(
        () => assertGuardedDeployEnvironment({
          ...valid,
          DATABASE_URL: `${runtimeUrl}&${parameter}`,
        }),
        (error) => {
          assert.match(
            error.message,
            /may contain only reviewed sslmode and channel_binding connection parameters/,
          );
          assert.doesNotMatch(error.message, /secret|evil|203\.0\.113\.1|postgresql:/);
          return true;
        },
      );
    }

    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        DATABASE_URL: runtimeUrl.replace("sslmode=verify-full", "sslmode=no-verify"),
      }),
      /DATABASE_URL must use sslmode=verify-full/,
    );
    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        DATABASE_URL: runtimeUrl.replace("sslmode=verify-full&", ""),
      }),
      /DATABASE_URL must use sslmode=verify-full/,
    );
    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        DATABASE_URL: `${runtimeUrl}&sslmode=verify-full`,
      }),
      /must not contain duplicate or case-variant connection parameters/,
    );
    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        DATABASE_URL: runtimeUrl.replace("channel_binding=require", "channel_binding=disable"),
      }),
      /channel_binding must be absent or require/,
    );
    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        DATABASE_URL: runtimeUrl.replace("sslmode=verify-full", "sslmode=VERIFY-FULL"),
      }),
      /must use sslmode=verify-full/,
    );
    assert.throws(
      () => assertGuardedDeployEnvironment({
        ...valid,
        DATABASE_URL: runtimeUrl.replace("channel_binding=require", "channel_binding=REQUIRE"),
      }),
      /channel_binding must be absent or require/,
    );

    for (const databaseUrl of [
      runtimeUrl.replace(":runtime-secret@", "@"),
      runtimeUrl.replace(":5432/", "/"),
      `${runtimeUrl}#fragment`,
      runtimeUrl.replace(":5432/neondb", ":5432//neondb"),
      runtimeUrl.replace(":5432/neondb", ":5432/neondb/"),
      runtimeUrl.replace(":5432/neondb", ":5432/neondb//"),
      runtimeUrl.replace(":5432/neondb", ":5432/neondb%3Fother"),
    ]) {
      assert.throws(
        () => assertGuardedDeployEnvironment({ ...valid, DATABASE_URL: databaseUrl }),
        (error) => {
          assert.doesNotMatch(error.message, /runtime-secret|postgresql:/);
          return true;
        },
      );
    }

    for (const environmentOverride of [
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { PGOPTIONS: "-c role=other" },
    ]) {
      assert.throws(
        () => assertGuardedDeployEnvironment({ ...valid, ...environmentOverride }),
        /must not/,
      );
    }
  });

  it("fails the current rollout tree without explicit phase authorization", () => {
    const currentMigrations = CURRENT_MIGRATIONS;

    assert.ok(currentMigrations.includes(SAVED_SEARCH_RPC_MIGRATION));
    assert.ok(currentMigrations.includes(SAVED_SEARCH_RPC_HARDENING_MIGRATION));
    assert.ok(currentMigrations.includes(SAVED_SEARCH_RLS_MIGRATION));
    assert.ok(currentMigrations.includes(SAVED_SEARCH_FORCE_RLS_MIGRATION));
    assert.throws(() => validate(undefined, currentMigrations), /is missing/);
    assert.throws(
      () => validate(RELEASE_ZERO, currentMigrations),
      /requires .* to be absent|remain the latest migration/,
    );
    assert.throws(
      () => validate(REVIEWED_PHASE_A, currentMigrations),
      /requires exactly the first three/,
    );
    assert.equal(
      validate(REVIEWED_PHASE_B, currentMigrations).phase,
      REVIEWED_PHASE_B,
    );
  });

  it("allows release 0 only when both RPC migrations exist and the RLS migration is absent", () => {
    assert.deepEqual(
      validate(RELEASE_ZERO, [
        SAVED_SEARCH_RPC_MIGRATION,
        SAVED_SEARCH_RPC_HARDENING_MIGRATION,
      ]),
      {
        phase: RELEASE_ZERO,
        hasRpcMigration: true,
        hasRpcHardeningMigration: true,
        hasRlsMigration: false,
      },
    );

    assert.throws(() => validate(RELEASE_ZERO, []), /requires/);
    assert.throws(
      () => validate(RELEASE_ZERO, [SAVED_SEARCH_RLS_MIGRATION]),
      /requires/,
    );
    assert.throws(
      () => validate(RELEASE_ZERO, [SAVED_SEARCH_RPC_MIGRATION]),
      /requires/,
    );
    assert.throws(
      () => validate(RELEASE_ZERO, [SAVED_SEARCH_RPC_HARDENING_MIGRATION]),
      /requires/,
    );
    assert.throws(
      () => validate(RELEASE_ZERO, [
        SAVED_SEARCH_RPC_MIGRATION,
        SAVED_SEARCH_RPC_HARDENING_MIGRATION,
        SAVED_SEARCH_RLS_MIGRATION,
      ]),
      /to be absent/,
    );
  });

  it("allows reviewed phase A only when all three rollout migrations exist", () => {
    assert.deepEqual(
      validate(REVIEWED_PHASE_A, [
        SAVED_SEARCH_RPC_MIGRATION,
        SAVED_SEARCH_RPC_HARDENING_MIGRATION,
        SAVED_SEARCH_RLS_MIGRATION,
      ]),
      {
        phase: REVIEWED_PHASE_A,
        hasRpcMigration: true,
        hasRpcHardeningMigration: true,
        hasRlsMigration: true,
      },
    );

    assert.throws(() => validate(REVIEWED_PHASE_A, []), /requires exactly the first three/);
    assert.throws(
      () => validate(REVIEWED_PHASE_A, [SAVED_SEARCH_RPC_MIGRATION]),
      /requires exactly the first three/,
    );
    assert.throws(
      () => validate(REVIEWED_PHASE_A, [SAVED_SEARCH_RLS_MIGRATION]),
      /requires exactly the first three/,
    );
    assert.throws(
      () => validate(REVIEWED_PHASE_A, [
        SAVED_SEARCH_RPC_MIGRATION,
        SAVED_SEARCH_RLS_MIGRATION,
      ]),
      /requires exactly the first three/,
    );
  });

  it("allows reviewed phase B only when all four rollout migrations exist", () => {
    assert.deepEqual(
      validate(REVIEWED_PHASE_B, REVIEWED_PHASE_B_MIGRATIONS),
      {
        phase: REVIEWED_PHASE_B,
        hasRpcMigration: true,
        hasRpcHardeningMigration: true,
        hasRlsMigration: true,
        hasForceRlsMigration: true,
      },
    );

    for (const migration of [
      SAVED_SEARCH_RPC_MIGRATION,
      SAVED_SEARCH_RPC_HARDENING_MIGRATION,
      SAVED_SEARCH_RLS_MIGRATION,
      SAVED_SEARCH_FORCE_RLS_MIGRATION,
    ]) {
      assert.throws(
        () => validate(
          REVIEWED_PHASE_B,
          REVIEWED_PHASE_B_MIGRATIONS.filter((name) => name !== migration),
        ),
        /requires all four/,
      );
    }
  });

  for (const phase of [RELEASE_ZERO, REVIEWED_PHASE_A, REVIEWED_PHASE_B]) {
    it(`rejects ${phase} when the internal context-gate route remains`, () => {
      assert.throws(
        () =>
          validate(phase, migrationsFor(phase), {
            contextGateRouteExists: true,
          }),
        new RegExp(RLS_CONTEXT_GATE_ROUTE_PATH.replaceAll("/", "\\/")),
      );
    });

    it(`rejects ${phase} when the exact middleware exemption remains`, () => {
      assert.throws(
        () =>
          validate(phase, migrationsFor(phase), {
            middlewareSource: `const isPublic = createRouteMatcher(["${RLS_CONTEXT_GATE_PUBLIC_PATH}"]);`,
          }),
        /middleware exemption/,
      );
    });

    it(`rejects ${phase} when a template or constant expression retains the middleware exemption`, () => {
      for (const middlewareSource of [
        `const isPublic = createRouteMatcher([\`${RLS_CONTEXT_GATE_PUBLIC_PATH}\`]);`,
        'const prefix = "/api/internal/"; const gate = prefix + "rls-context-gate"; const isPublic = createRouteMatcher([gate]);',
      ]) {
        assert.equal(
          middlewareContainsContextGateExemption(middlewareSource),
          true,
        );
        assert.throws(
          () => validate(phase, migrationsFor(phase), { middlewareSource }),
          /middleware exemption/,
        );
      }
    });

    it(`does not treat a ${phase} middleware comment as an active exemption but rejects the unreviewed drift`, () => {
      const middlewareSource =
        `// removed createRouteMatcher(["${RLS_CONTEXT_GATE_PUBLIC_PATH}"])`;
      assert.equal(
        middlewareContainsContextGateExemption(middlewareSource),
        false,
      );
      assert.throws(
        () => validate(phase, migrationsFor(phase), { middlewareSource }),
        /middleware fingerprint changed/,
      );
    });

    it(`rejects ${phase} middleware drift even when dynamic construction evades the AST helper`, () => {
      for (const middlewareSource of [
        'const gate = ["", "api", "internal", "rls-context-gate"].join("/"); const isPublic = createRouteMatcher([gate]);',
        'const gate = "/api/internal/".concat("rls-context-gate"); const isPublic = createRouteMatcher([gate]);',
        'import { previewGatePath } from "./preview-gate"; const isPublic = createRouteMatcher([previewGatePath]);',
      ]) {
        assert.equal(
          middlewareContainsContextGateExemption(middlewareSource),
          false,
        );
        assert.throws(
          () => validate(phase, migrationsFor(phase), { middlewareSource }),
          /middleware fingerprint changed/,
        );
      }
    });

    it(`accepts ${phase} only when both context-gate artifacts are absent`, () => {
      assert.equal(validate(phase, migrationsFor(phase)).phase, phase);
    });
  }

  it("rejects a combined provider-gate shape and accepts only the cleaned production shape", () => {
    assert.throws(
      () =>
        validate(RELEASE_ZERO, RELEASE_ZERO_MIGRATIONS, {
          contextGateRouteExists: true,
          contextGateRunnerTestExists: true,
          middlewareSource: CURRENT_MIDDLEWARE_SOURCE,
        }),
      /production artifact must exclude the temporary RLS context gate/,
    );

    assert.equal(
      validate(RELEASE_ZERO, RELEASE_ZERO_MIGRATIONS, {
        contextGateRouteExists: false,
        contextGateRunnerTestExists: false,
        middlewareSource: REVIEWED_PRODUCTION_MIDDLEWARE_SOURCE,
      }).phase,
      RELEASE_ZERO,
    );
  });

  it("runs the clean Release-0 artifact guard unconditionally in CI before migrations", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    assert.equal(
      packageJson.scripts?.["verify:rls-release-artifact"],
      "node scripts/verify-saved-search-rls-release-artifact.mjs",
    );
    assert.match(
      workflow,
      /Verify SavedSearch Release 0 production artifact[\s\S]{0,180}SAVED_SEARCH_RLS_DEPLOY_PHASE: release-0[\s\S]{0,180}npm run verify:rls-release-artifact[\s\S]{0,400}Apply migrations to CI Postgres/,
    );
  });

  it("fails closed for missing, empty, or unknown phase values", () => {
    const rolloutMigrations = [
      SAVED_SEARCH_RPC_MIGRATION,
      SAVED_SEARCH_RPC_HARDENING_MIGRATION,
      SAVED_SEARCH_RLS_MIGRATION,
      SAVED_SEARCH_FORCE_RLS_MIGRATION,
    ];

    assert.throws(() => validate(undefined, rolloutMigrations), /is missing/);
    assert.throws(() => validate("", rolloutMigrations), /is missing/);
    assert.throws(() => validate("phase-a", rolloutMigrations), /expected/);
    assert.throws(() => validate("release-1", rolloutMigrations), /expected/);
  });

  it("requires the reviewed phase migration to remain latest", () => {
    const laterMigration = "20260720070000_unreviewed_later_migration";

    assert.throws(
      () => validate(RELEASE_ZERO, [
        SAVED_SEARCH_RPC_MIGRATION,
        SAVED_SEARCH_RPC_HARDENING_MIGRATION,
        laterMigration,
      ]),
      /remain the latest migration/,
    );
    assert.throws(
      () => validate(REVIEWED_PHASE_A, [
        SAVED_SEARCH_RPC_MIGRATION,
        SAVED_SEARCH_RPC_HARDENING_MIGRATION,
        SAVED_SEARCH_RLS_MIGRATION,
        SAVED_SEARCH_FORCE_RLS_MIGRATION,
      ]),
      /requires exactly the first three/,
    );
    assert.throws(
      () => validate(REVIEWED_PHASE_B, [
        ...REVIEWED_PHASE_B_MIGRATIONS,
        laterMigration,
      ]),
      /review or retire the temporary SavedSearch deploy guard/,
    );
  });

  it("pins the exact reviewed migration inventory and SQL contents", () => {
    assert.equal(
      computeMigrationTreeSha256("prisma/migrations", RELEASE_ZERO_MIGRATIONS),
      RELEASE_ZERO_MIGRATION_TREE_SHA256,
    );
    assert.equal(
      computeMigrationTreeSha256("prisma/migrations", REVIEWED_PHASE_A_MIGRATIONS),
      PHASE_A_MIGRATION_TREE_SHA256,
    );
    assert.equal(
      computeMigrationTreeSha256("prisma/migrations", REVIEWED_PHASE_B_MIGRATIONS),
      PHASE_B_MIGRATION_TREE_SHA256,
    );

    assert.throws(
      () => validate(RELEASE_ZERO, [
        ...RELEASE_ZERO_MIGRATIONS,
        "20260717024999_enable_saved_search_rls",
      ], {
        migrationTreeSha256: "unreviewed-backdated-migration",
      }),
      /migration tree fingerprint changed/,
    );
    assert.throws(
      () => validate(RELEASE_ZERO, RELEASE_ZERO_MIGRATIONS, {
        migrationTreeSha256: "modified-reviewed-migration",
      }),
      /migration tree fingerprint changed/,
    );
  });

  it("pins the Prisma config so an alternate effective migration tree cannot evade review", () => {
    const redirectedConfig = `
      import { defineConfig } from "prisma/config";
      export default defineConfig({
        datasource: { url: process.env.DIRECT_URL ?? "" },
        migrations: { path: "alternate/migrations" },
      });
    `;

    assert.notEqual(
      computeTextSha256(redirectedConfig),
      REVIEWED_PRISMA_CONFIG_SHA256,
    );
    assert.throws(
      () => validate(RELEASE_ZERO, RELEASE_ZERO_MIGRATIONS, {
        prismaConfigSha256: computeTextSha256(redirectedConfig),
      }),
      /effective Prisma migration directory could have been redirected/,
    );
  });

  it("recursively detects context-gate artifacts across route groups, catch-alls, custom extensions, and symlinks", () => {
    const fixtures = [
      {
        relativePath: "src/app/api/internal/rls-context-gate/route.gate.ts",
        source: "export const POST = () => null;\n",
      },
      {
        relativePath: "src/app/(preview)/api/internal/rls-context-gate/route.ts",
        source: "export const POST = () => null;\n",
      },
      {
        relativePath: "src/app/api/internal/[...slug]/route.unreviewed",
        source: "const secret = process.env.RLS_CONTEXT_GATE_TRIGGER_SECRET;\n",
      },
    ];

    for (const fixture of fixtures) {
      const rootDirectory = mkdtempSync(join(tmpdir(), "grainline-rls-route-"));
      try {
        const artifactPath = join(rootDirectory, fixture.relativePath);
        mkdirSync(join(artifactPath, ".."), { recursive: true });
        writeFileSync(artifactPath, fixture.source);
        assert.equal(contextGateRouteArtifactExists(rootDirectory), true);
        assert.ok(
          findContextGateAppArtifacts(rootDirectory).includes(
            fixture.relativePath,
          ),
        );
      } finally {
        rmSync(rootDirectory, { force: true, recursive: true });
      }
    }

    const rootDirectory = mkdtempSync(join(tmpdir(), "grainline-rls-symlink-"));
    try {
      const fixturePath = join(rootDirectory, "fixtures/context-gate-runner.ts");
      const routePath = join(rootDirectory, "src/app/api/internal/gate/route.ts");
      mkdirSync(join(fixturePath, ".."), { recursive: true });
      mkdirSync(join(routePath, ".."), { recursive: true });
      writeFileSync(
        fixturePath,
        "const allowed = process.env.RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA;\n",
      );
      symlinkSync(fixturePath, routePath);

      assert.equal(contextGateRouteArtifactExists(rootDirectory), true);
      assert.deepEqual(findContextGateAppArtifacts(rootDirectory), [
        "src/app/api/internal/gate/route.ts",
      ]);
    } finally {
      rmSync(rootDirectory, { force: true, recursive: true });
    }

    const cleanRoot = mkdtempSync(join(tmpdir(), "grainline-rls-clean-"));
    try {
      const cleanRoute = join(cleanRoot, "src/app/api/health/route.custom.ts");
      mkdirSync(join(cleanRoute, ".."), { recursive: true });
      writeFileSync(cleanRoute, "export const GET = () => Response.json({ ok: true });\n");
      assert.equal(contextGateRouteArtifactExists(cleanRoot), false);
      assert.deepEqual(findContextGateAppArtifacts(cleanRoot), []);
    } finally {
      rmSync(cleanRoot, { force: true, recursive: true });
    }
  });

  it("rejects exact, renamed, and symlinked runner-only tests mechanically", () => {
    assert.throws(
      () => validate(RELEASE_ZERO, RELEASE_ZERO_MIGRATIONS, {
        contextGateRunnerTestExists: true,
      }),
      new RegExp(RLS_CONTEXT_GATE_RUNNER_TEST_PATH.replaceAll("/", "\\/")),
    );

    const rootDirectory = mkdtempSync(join(tmpdir(), "grainline-rls-test-"));
    try {
      const runnerTestPath = join(rootDirectory, RLS_CONTEXT_GATE_RUNNER_TEST_PATH);
      mkdirSync(join(runnerTestPath, ".."), { recursive: true });
      writeFileSync(runnerTestPath, "// Preview-only runner test\n");
      assert.equal(contextGateRunnerTestExists(rootDirectory), true);
      assert.deepEqual(findContextGateRunnerTestArtifacts(rootDirectory), [
        RLS_CONTEXT_GATE_RUNNER_TEST_PATH,
      ]);
    } finally {
      rmSync(rootDirectory, { force: true, recursive: true });
    }

    const renamedRoot = mkdtempSync(join(tmpdir(), "grainline-rls-renamed-test-"));
    try {
      const renamedPath = join(renamedRoot, "tests/security/provider-proof.spec.ts");
      mkdirSync(join(renamedPath, ".."), { recursive: true });
      writeFileSync(
        renamedPath,
        `// ${RLS_CONTEXT_GATE_RUNNER_TEST_MARKER}\nconst route = ${JSON.stringify(RLS_CONTEXT_GATE_ROUTE_PATH)};\n`,
      );
      assert.deepEqual(findContextGateRunnerTestArtifacts(renamedRoot), [
        "tests/security/provider-proof.spec.ts",
      ]);
      assert.equal(contextGateRunnerTestExists(renamedRoot), true);
    } finally {
      rmSync(renamedRoot, { force: true, recursive: true });
    }

    const symlinkRoot = mkdtempSync(join(tmpdir(), "grainline-rls-test-symlink-"));
    try {
      const testsDirectory = join(symlinkRoot, "tests");
      mkdirSync(testsDirectory, { recursive: true });
      symlinkSync("missing-runner-test.mjs", join(testsDirectory, "provider-proof.test.mjs"));
      assert.deepEqual(findContextGateRunnerTestArtifacts(symlinkRoot), [
        "tests/provider-proof.test.mjs",
      ]);
      assert.equal(contextGateRunnerTestExists(symlinkRoot), true);
    } finally {
      rmSync(symlinkRoot, { force: true, recursive: true });
    }

    const cleanRoot = mkdtempSync(join(tmpdir(), "grainline-rls-clean-test-"));
    try {
      const cleanPath = join(cleanRoot, "tests/deploy-guard.test.mjs");
      mkdirSync(join(cleanPath, ".."), { recursive: true });
      writeFileSync(
        cleanPath,
        `const route = ${JSON.stringify(RLS_CONTEXT_GATE_ROUTE_PATH)};\n// production guard coverage only\n`,
      );
      assert.deepEqual(findContextGateRunnerTestArtifacts(cleanRoot), []);
      assert.equal(contextGateRunnerTestExists(cleanRoot), false);
    } finally {
      rmSync(cleanRoot, { force: true, recursive: true });
    }
  });

  it("keeps the historical guarded migration command out of Vercel application builds", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    const { buildCommand } = vercel;
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const guardedMigrationCommand = "npm run migrate:deploy:guarded";

    assert.equal(
      pkg.scripts["migrate:deploy:guarded"],
      "node scripts/guard-saved-search-rls-deploy.mjs && prisma migrate deploy && npm run audit:db-grants -- --require-direct-url",
    );
    const guardedSteps = pkg.scripts["migrate:deploy:guarded"].split(" && ");
    assert.deepEqual(guardedSteps, [
      "node scripts/guard-saved-search-rls-deploy.mjs",
      "prisma migrate deploy",
      "npm run audit:db-grants -- --require-direct-url",
    ]);
    assert.equal(
      pkg.scripts["guard:runtime-db-env"],
      "node scripts/guard-runtime-db-env.mjs",
    );
    assert.equal(buildCommand, "npm run guard:runtime-db-env && npm run build");
    assert.doesNotMatch(buildCommand, /migrat|DIRECT_URL|MIGRATION_DB_ROLE/i);
    assert.equal(vercel.git.deploymentEnabled.main, false);
    assert.equal(buildCommand.includes(guardedMigrationCommand), false);
  });

  it("documents the exact pre-migration identity gate and retained owner-credential residual", () => {
    for (const file of [
      "CLAUDE.md",
      "docs/runbook.md",
      "docs/launch-checklist.md",
      "docs/db-defense-in-depth-plan.md",
    ]) {
      const contract = readFileSync(file, "utf8");
      assert.match(
        contract,
        /before any migration runs[\s\S]{0,500}`DATABASE_URL`[\s\S]{0,120}`DIRECT_URL`/i,
        `${file} must require both database URLs before migrations`,
      );
      assert.match(
        contract,
        /RUNTIME_DB_ROLE=grainline_app_runtime[\s\S]{0,180}MIGRATION_DB_ROLE=neondb_owner/,
        `${file} must pin both reviewed roles`,
      );
      assert.match(
        contract,
        /pooled[\s\S]{0,300}direct[\s\S]{0,300}(?:same|identify the same) (?:Neon )?endpoint,\s+region, port,\s+and database/i,
        `${file} must pin the pooled/direct target relationship`,
      );
      assert.match(
        contract,
        /sslmode=verify-full[\s\S]{0,180}channel_binding=require/i,
        `${file} must pin the reviewed remote connection parameters`,
      );
      assert.match(contract, /explicit[^\n]{0,80}password/i, `${file} must require an explicit password`);
      assert.match(contract, /explicit[^\n]{0,40}:5432/i, `${file} must require explicit port 5432`);
      assert.match(
        contract,
        /unencoded[^\n]{0,80}(?:bounded )?database path segment/i,
        `${file} must require a canonical database path`,
      );
      assert.match(contract, /NODE_TLS_REJECT_UNAUTHORIZED=0/, `${file} must reject disabled Node TLS verification`);
      assert.match(contract, /PGOPTIONS/, `${file} must reject inherited PostgreSQL session options`);
      assert.match(contract, /--allow-loopback-ci/, `${file} must make the insecure CI transport explicit`);
      assert.match(
        contract,
        /channel.binding[\s\S]{0,180}(?:does not|must not)[\s\S]{0,100}(?:prove|claim|hard)/i,
        `${file} must not overclaim channel-binding enforcement`,
      );
      assert.match(
        contract,
        /current_database\(\)[\s\S]{0,260}current_user[\s\S]{0,80}session_user|current_database\(\)[\s\S]{0,260}current_user`\/`session_user/i,
        `${file} must require live database and migration-owner identity proof`,
      );
      assert.match(contract, /byte-for-byte/i, `${file} must require exact Preview URL bytes`);
      assert.match(
        contract,
        /digest equality/i,
        `${file} must verify Preview URL equality before the run claim`,
      );
      assert.match(contract, /renamed/i, `${file} must reject renamed runner tests`);
      assert.match(contract, /symlink/i, `${file} must reject test-tree symlinks`);
      assert.match(contract, /recursiv/i, `${file} must document recursive runner-test scanning`);
      assert.match(
        contract,
        /Build Step/i,
        `${file} must retain the Vercel build credential boundary`,
      );
      assert.match(
        contract,
        /Function execution/i,
        `${file} must retain the Vercel Function credential boundary`,
      );
      assert.match(
        contract,
        /(?:externalize|move|run) owner migrations?[\s\S]{0,220}grant[\s-]+audit/i,
        `${file} must retain the owner-migration pipeline follow-up`,
      );
      assert.match(
        contract,
        /remove `DIRECT_URL`(?: plus|\/| and)?[\s\S]{0,100}`?MIGRATION_DB_ROLE`?[\s\S]{0,180}production Function environment/i,
        `${file} must require removing owner deployment credentials from Functions`,
      );
      assert.match(
        contract,
        /before expanding\s+(?:RLS to\s+)?Bucket B/i,
        `${file} must keep the credential-separation follow-up ahead of Bucket B`,
      );
    }
  });

  it("keeps the human promotion meaning of all three phase values documented", () => {
    const contractFiles = [
      "CLAUDE.md",
      "docs/runbook.md",
      "docs/launch-checklist.md",
      "docs/db-defense-in-depth-plan.md",
      "docs/rls-feasibility-plan.md",
    ];

    for (const file of contractFiles) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /SAVED_SEARCH_RLS_DEPLOY_PHASE=release-0/);
      assert.match(source, /phase-a-reviewed/);
      assert.match(source, /phase-b-reviewed/);
    }

    const runbook = readFileSync("docs/runbook.md", "utf8");
    assert.match(runbook, /explicit\s+human promotion authorization/);
    assert.match(runbook, /Never\s+use it to bypass the guard/);
  });
});

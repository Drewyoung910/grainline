import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTIONS,
  DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES,
} from "../scripts/direct-upload-activation-catalog.mjs";
import {
  LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
  LISTING_VARIANTS_REVIEWED_MIGRATION,
} from "../scripts/direct-upload-activation-failure-inspect.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_FAILED_PRODUCTION_RUN_ID,
  DIRECT_UPLOAD_ACTIVATION_PRODUCTION_RECOVERY_CONFIRMATION,
  DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROOF_RUN_ID,
  classifyDirectUploadActivationProductionRecoveryLedger,
  collectDirectUploadActivatedRecoveryIssues,
  collectDirectUploadRecoveryMigrationTreeIssues,
  parseDirectUploadActivationProductionRecoveryConfig,
  writeDirectUploadActivationProductionRecoveryEvidence,
} from "../scripts/direct-upload-activation-production-recovery.mjs";
import {
  directUploadFunctionSources,
} from "../scripts/direct-upload-function-source-catalog.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "../scripts/verify-direct-upload-activation-release.mjs";

const RELEASE_COMMIT = "e".repeat(40);
const LISTING_VARIANTS_CHECKSUM = "a".repeat(64);
const OWNER_URL =
  "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function temporaryDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "direct-upload-production-recovery-"),
  );
}

function environment(directory, mode = "inspect", overrides = {}) {
  return {
    DIRECT_URL: OWNER_URL,
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256:
      createHash("sha256").update(OWNER_URL).digest("hex"),
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    MIGRATION_DB_ROLE: "neondb_owner",
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "Drewyoung910/grainline",
    GITHUB_RUN_ID: "30740000001",
    GITHUB_SHA: RELEASE_COMMIT,
    RUNNER_TEMP: directory,
    DIRECT_UPLOAD_ACTIVATION_RECOVERY_RELEASE_COMMIT: RELEASE_COMMIT,
    DIRECT_UPLOAD_ACTIVATION_RECOVERY_MAIN_CI_RUN_ID: "30740000000",
    DIRECT_UPLOAD_ACTIVATION_FAILED_MIGRATION_RUN_ID:
      DIRECT_UPLOAD_ACTIVATION_FAILED_PRODUCTION_RUN_ID,
    DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROOF_RUN_ID,
    DIRECT_UPLOAD_ACTIVATION_RECOVERY_CONFIRM:
      DIRECT_UPLOAD_ACTIVATION_PRODUCTION_RECOVERY_CONFIRMATION,
    DIRECT_UPLOAD_ACTIVATION_RECOVERY_EVIDENCE_PATH: path.join(
      directory,
      `direct-upload-activation-production-recovery-${RELEASE_COMMIT}-${mode}.json`,
    ),
    ...overrides,
  };
}

function failedRow(rolledBack = false) {
  return {
    checksum: FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
    started_at: new Date("2026-08-01T19:00:00.000Z"),
    finished_at: null,
    rolled_back_at: rolledBack
      ? new Date("2026-08-02T01:00:00.000Z")
      : null,
    applied_steps_count: 0,
  };
}

function correctedRow() {
  return {
    checksum: DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256,
    started_at: new Date("2026-08-02T01:01:00.000Z"),
    finished_at: new Date("2026-08-02T01:01:01.000Z"),
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function migrationSummary(
  migrationName,
  {
    applied = 1,
    appliedSteps = applied,
    checksum = "b".repeat(64),
    finished = applied,
    incomplete = 0,
    rolledBack = 0,
  } = {},
) {
  return {
    migration_name: migrationName,
    checksum,
    applied_count: applied,
    applied_steps_count: appliedSteps,
    finished_count: finished,
    incomplete_count: incomplete,
    rolled_back_count: rolledBack,
    row_count: applied + incomplete + rolledBack,
  };
}

function listingVariantsLedger(overrides = {}) {
  return [
    migrationSummary(LISTING_VARIANTS_REVIEWED_MIGRATION, {
      checksum: LISTING_VARIANTS_CHECKSUM,
    }),
    migrationSummary(LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS, {
      applied: 0,
      appliedSteps: 0,
      checksum: LISTING_VARIANTS_CHECKSUM,
      rolledBack: 1,
      ...overrides,
    }),
  ];
}

function activatedSnapshot() {
  return {
    currentUser: "neondb_owner",
    sessionUser: "neondb_owner",
    transactionReadOnly: "on",
    role: {
      rolname: "grainline_direct_upload_cleanup_v2",
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolcanlogin: true,
      rolreplication: false,
      rolbypassrls: false,
    },
    memberships: [],
    memberRoles: ["neondb_owner"],
    memberRoleEdges: [{
      member_role: "neondb_owner",
      grantor_role: "cloud_admin",
      admin_option: true,
      inherit_option: false,
      set_option: false,
    }],
    schemaUsage: true,
    schemaCreate: false,
    databaseCreate: false,
    tablePrivileges: [],
    columnPrivileges: [],
    sequencePrivileges: [],
    defaultPrivileges: [],
    unexpectedFunctionPrivileges: [],
    incompleteMigrationCount: 0,
    tables: ["DirectUpload", "DirectUploadReference"].map((tableName) => ({
      table_name: tableName,
      owner_name: "neondb_owner",
      rls_enabled: true,
      rls_forced: true,
      policy_count: 0,
      runtime_select: false,
      runtime_insert: false,
      runtime_update: false,
      runtime_delete: false,
      cleanup_select: false,
      cleanup_insert: false,
      cleanup_update: false,
      cleanup_delete: false,
    })),
  };
}

function activatedFunctions() {
  const sources = directUploadFunctionSources();
  const invokerNames = new Set(DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES);
  const runtimeNames = new Set(DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES);
  const cleanupNames = new Set(DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES);
  return DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.map((entry) => ({
    function_name: entry.name,
    identity_arguments: entry.identityArguments,
    owner_name: "neondb_owner",
    function_source: sources[entry.name],
    security_definer: !invokerNames.has(entry.name),
    leakproof: false,
    function_kind: "f",
    function_config: ["search_path=pg_catalog"],
    cleanup_execute: cleanupNames.has(entry.name),
    runtime_execute: runtimeNames.has(entry.name),
    cleanup_direct_execute: cleanupNames.has(entry.name),
    runtime_direct_execute: runtimeNames.has(entry.name),
    cleanup_execute_grantable: false,
    runtime_execute_grantable: false,
    public_execute: false,
    other_role_execute: [],
    other_role_execute_grantable: [],
  }));
}

describe("DirectUpload activation production recovery", () => {
  it("accepts only the exact manual protected owner context and bindings", () => {
    const directory = temporaryDirectory();
    try {
      const config = parseDirectUploadActivationProductionRecoveryConfig(
        environment(directory),
        ["--inspect"],
      );
      assert.equal(config.mode, "inspect");
      assert.equal(config.releaseCommit, RELEASE_COMMIT);
      assert.equal(
        config.failedMigrationRunId,
        DIRECT_UPLOAD_ACTIVATION_FAILED_PRODUCTION_RUN_ID,
      );
      assert.equal(
        config.recoveryProofRunId,
        DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROOF_RUN_ID,
      );
      assert.equal(config.identity.username, "neondb_owner");
      assert.equal(config.identity.isPooler, false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects source, confirmation, run, credential, digest and path drift", () => {
    const directory = temporaryDirectory();
    try {
      const cases = [
        { GITHUB_REF: "refs/heads/feature" },
        { GITHUB_REPOSITORY: "example/fork" },
        { GITHUB_SHA: "d".repeat(40) },
        { DIRECT_UPLOAD_ACTIVATION_RECOVERY_CONFIRM: "yes" },
        { DIRECT_UPLOAD_ACTIVATION_FAILED_MIGRATION_RUN_ID: "30729632411" },
        { DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROOF_RUN_ID: "30734098368" },
        { DIRECT_UPLOAD_ACTIVATION_RECOVERY_MAIN_CI_RUN_ID: "0" },
        { DATABASE_URL: "present" },
        { PRODUCTION_MIGRATION_DIRECT_URL: "present" },
        { DIRECT_UPLOAD_CLEANUP_DATABASE_URL: "present" },
        { PRODUCTION_MIGRATION_DIRECT_URL_SHA256: "0".repeat(64) },
        {
          DIRECT_UPLOAD_ACTIVATION_RECOVERY_EVIDENCE_PATH:
            path.join(directory, "wrong.json"),
        },
      ];
      for (const overrides of cases) {
        assert.throws(() =>
          parseDirectUploadActivationProductionRecoveryConfig(
            environment(directory, "inspect", overrides),
            ["--inspect"],
          ));
      }
      assert.throws(() =>
        parseDirectUploadActivationProductionRecoveryConfig(
          environment(directory),
          ["--resolve"],
        ));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("classifies only the exact failed, resolved and activated ledgers", () => {
    assert.equal(
      classifyDirectUploadActivationProductionRecoveryLedger([failedRow()]),
      "failed",
    );
    assert.equal(
      classifyDirectUploadActivationProductionRecoveryLedger([
        failedRow(true),
      ]),
      "resolved",
    );
    assert.equal(
      classifyDirectUploadActivationProductionRecoveryLedger([
        failedRow(true),
        correctedRow(),
      ]),
      "activated",
    );
    assert.throws(() =>
      classifyDirectUploadActivationProductionRecoveryLedger([
        { ...failedRow(), applied_steps_count: 1 },
      ]));
    assert.throws(() =>
      classifyDirectUploadActivationProductionRecoveryLedger([
        failedRow(true),
        { ...correctedRow(), finished_at: null },
      ]));
    assert.throws(() =>
      classifyDirectUploadActivationProductionRecoveryLedger([
        failedRow(true),
        { ...correctedRow(), checksum: "0".repeat(64) },
      ]));
  });

  it("accepts only the exact historical listing-variants alias and sole pending activation", () => {
    const activation = DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName;
    const predecessorName = "20260801175000_predecessor";
    const migrationNames = [
      LISTING_VARIANTS_REVIEWED_MIGRATION,
      predecessorName,
      activation,
    ];
    const predecessor = migrationSummary(predecessorName);
    assert.deepEqual(
      collectDirectUploadRecoveryMigrationTreeIssues({
        listingVariantsChecksum: LISTING_VARIANTS_CHECKSUM,
        migrationNames,
        state: "failed",
        ledgerSummaries: [
          ...listingVariantsLedger(),
          predecessor,
          migrationSummary(activation, { applied: 0, incomplete: 1 }),
        ],
      }),
      [],
    );
    assert.deepEqual(
      collectDirectUploadRecoveryMigrationTreeIssues({
        listingVariantsChecksum: LISTING_VARIANTS_CHECKSUM,
        migrationNames,
        state: "resolved",
        ledgerSummaries: [
          ...listingVariantsLedger(),
          predecessor,
          migrationSummary(activation, { applied: 0, rolledBack: 1 }),
        ],
      }),
      [],
    );
    assert.deepEqual(
      collectDirectUploadRecoveryMigrationTreeIssues({
        listingVariantsChecksum: LISTING_VARIANTS_CHECKSUM,
        migrationNames,
        state: "activated",
        ledgerSummaries: [
          ...listingVariantsLedger(),
          predecessor,
          migrationSummary(activation, { applied: 1, rolledBack: 1 }),
        ],
      }),
      [],
    );
    assert.match(
      collectDirectUploadRecoveryMigrationTreeIssues({
        listingVariantsChecksum: LISTING_VARIANTS_CHECKSUM,
        migrationNames,
        state: "resolved",
        ledgerSummaries: [
          ...listingVariantsLedger(),
          migrationSummary(predecessorName, {
            applied: 0,
            appliedSteps: 0,
          }),
          migrationSummary(activation, { applied: 0, rolledBack: 1 }),
        ],
      }).join("; "),
      /predecessor.*not exact|sole pending/u,
    );
    assert.match(
      collectDirectUploadRecoveryMigrationTreeIssues({
        listingVariantsChecksum: LISTING_VARIANTS_CHECKSUM,
        migrationNames: [...migrationNames, "20260802000000_later"],
        state: "resolved",
        ledgerSummaries: [],
      }).join("; "),
      /tree order is not exact/u,
    );
    for (const driftedAliasRows of [
      listingVariantsLedger({ applied: 1, rolledBack: 0 }),
      listingVariantsLedger({ incomplete: 1, rolledBack: 0 }),
      listingVariantsLedger({ finished: 1 }),
      listingVariantsLedger({ appliedSteps: 1 }),
      listingVariantsLedger({ checksum: "c".repeat(64) }),
      [listingVariantsLedger()[0]],
    ]) {
      assert.match(
        collectDirectUploadRecoveryMigrationTreeIssues({
          listingVariantsChecksum: LISTING_VARIANTS_CHECKSUM,
          migrationNames,
          state: "resolved",
          ledgerSummaries: [
            ...driftedAliasRows,
            predecessor,
            migrationSummary(activation, { applied: 0, rolledBack: 1 }),
          ],
        }).join("; "),
        /historical alias|historical listing-variants/u,
      );
    }
    assert.match(
      collectDirectUploadRecoveryMigrationTreeIssues({
        listingVariantsChecksum: LISTING_VARIANTS_CHECKSUM,
        migrationNames,
        state: "resolved",
        ledgerSummaries: [
          ...listingVariantsLedger(),
          predecessor,
          migrationSummary(activation, { applied: 0, rolledBack: 1 }),
          migrationSummary("20260423000001_unknown_alias", {
            applied: 0,
            appliedSteps: 0,
            rolledBack: 1,
          }),
        ],
      }).join("; "),
      /ledger names do not match/u,
    );
    for (const predecessorDrift of [
      { incomplete: 1 },
      { rolledBack: 1 },
    ]) {
      assert.match(
        collectDirectUploadRecoveryMigrationTreeIssues({
          listingVariantsChecksum: LISTING_VARIANTS_CHECKSUM,
          migrationNames,
          state: "resolved",
          ledgerSummaries: [
            ...listingVariantsLedger(),
            migrationSummary(predecessorName, predecessorDrift),
            migrationSummary(activation, { applied: 0, rolledBack: 1 }),
          ],
        }).join("; "),
        /predecessor ledger summary is not exact/u,
      );
    }
  });

  it("accepts the exact activated service boundary and rejects authority drift", () => {
    const snapshot = activatedSnapshot();
    const functions = activatedFunctions();
    assert.deepEqual(
      collectDirectUploadActivatedRecoveryIssues(snapshot, functions),
      [],
    );
    assert.match(
      collectDirectUploadActivatedRecoveryIssues(
        {
          ...snapshot,
          tables: snapshot.tables.map((row, index) =>
            index === 0 ? { ...row, runtime_select: true } : row),
        },
        functions,
      ).join("; "),
      /DirectUpload activated service-table posture drifted/u,
    );
    assert.match(
      collectDirectUploadActivatedRecoveryIssues(
        snapshot,
        functions.map((row, index) =>
          index === 0 ? { ...row, public_execute: true } : row),
      ).join("; "),
      /execution mode drifted/u,
    );
  });

  it("writes only fresh mode-0600 sanitized evidence", () => {
    const directory = temporaryDirectory();
    const target = path.join(directory, "evidence.json");
    try {
      writeDirectUploadActivationProductionRecoveryEvidence(target, {
        status: "passed",
        productionChangedByProof: false,
      });
      assert.equal(fs.statSync(target).mode & 0o777, 0o600);
      assert.throws(() =>
        writeDirectUploadActivationProductionRecoveryEvidence(
          path.join(directory, "url.json"),
          { value: OWNER_URL },
        ));
      assert.throws(() =>
        writeDirectUploadActivationProductionRecoveryEvidence(
          path.join(directory, "rows.json"),
          { rows: [{ id: "private" }] },
        ));
      assert.throws(() =>
        writeDirectUploadActivationProductionRecoveryEvidence(target, {
          status: "duplicate",
        }));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the proof read-only and wires only the exact restart-safe workflow", () => {
    const script = fs.readFileSync(
      "scripts/direct-upload-activation-production-recovery.mjs",
      "utf8",
    );
    const plan = fs.readFileSync(
      "docs/direct-upload-activation-production-recovery-plan.md",
      "utf8",
    );
    assert.match(
      script,
      /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/u,
    );
    assert.match(
      script,
      /pg_catalog\.min\(checksum\) AS checksum[\s\S]*GROUP BY migration_name[\s\S]*ORDER BY migration_name/u,
    );
    assert.doesNotMatch(script, /GROUP BY migration_name, checksum/u);
    assert.match(script, /productionChangedByProof: false/u);
    assert.doesNotMatch(
      script,
      /client\.query\(`?(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)/u,
    );
    const workflow = fs.readFileSync(
      ".github/workflows/direct-upload-activation-production-recovery.yml",
      "utf8",
    );
    assert.match(
      plan,
      /Status: corrected-migration PR #139 and recovery PR #140 are merged[\s\S]*initial read-only migration-tree guard/u,
    );
    assert.match(
      plan,
      /95943014716b4654b1654d740f601ae755ed1740[\s\S]*30757000208[\s\S]*736bdc57d8ecac14dcac6690a386c96cf9e655e1[\s\S]*30758315593[\s\S]*36484fcf02855308eac9d013307612afebb8f2e6[\s\S]*30760097011/u,
    );
    assert.match(
      plan,
      /30729632410[\s\S]*30734098369[\s\S]*exact successful main CI run/u,
    );
    assert.match(
      plan,
      /inspect[\s\S]*resolve[\s\S]*resolved[\s\S]*deploy[\s\S]*activated/u,
    );
    assert.match(
      workflow,
      /github\.repository == 'Drewyoung910\/grainline' && github\.ref == 'refs\/heads\/main'/u,
    );
    assert.match(workflow, /environment: Production/u);
    assert.match(workflow, /group: production-database-migrations/u);
    assert.match(workflow, /actions: read[\s\S]*contents: read/u);
    assert.match(
      workflow,
      /DIRECT_URL: \$\{\{ secrets\.PRODUCTION_MIGRATION_DIRECT_URL \}\}/u,
    );
    assert.doesNotMatch(
      workflow,
      /DATABASE_URL:|GRANT_AUDIT_DATABASE_URL:|DIRECT_UPLOAD_CLEANUP_DATABASE_URL:|R2_ACCESS_KEY|R2_SECRET/u,
    );
    assert.doesNotMatch(workflow, /Number\('\$\{\{ inputs\./u);
    assert.match(workflow, /process\.env\.REVIEWED_RELEASE_COMMIT/u);
    assert.match(workflow, /run\.event !== reviewed\.event/u);
    const inspect = workflow.indexOf("Inspect exact restart state read-only");
    const release = workflow.indexOf(
      "Verify exact corrected DirectUpload activation release",
    );
    const resolve = workflow.indexOf(
      "Mark only the exact failed zero-step row rolled back",
    );
    const resolved = workflow.indexOf(
      "Prove exact resolved compatible boundary read-only",
    );
    const deploy = workflow.indexOf(
      "Apply only the corrected reviewed activation",
    );
    const converge = workflow.indexOf(
      "Converge activated runtime and cleanup grants",
    );
    const status = workflow.indexOf(
      "Verify recovered production migration status",
    );
    const audit = workflow.indexOf(
      "Audit recovered runtime grants and RLS catalog",
    );
    const activated = workflow.indexOf(
      "Prove exact activated owner boundary read-only",
    );
    assert.ok(
      inspect >= 0
      && inspect < release
      && release < resolve
      && resolve < resolved
      && resolved < deploy
      && deploy < converge
      && converge < status
      && status < audit
      && audit < activated,
    );
    assert.match(
      workflow,
      /if: steps\.inspect\.outputs\.state == 'failed'[\s\S]*--rolled-back 20260801194000_enable_direct_upload_rls/u,
    );
    assert.match(
      workflow,
      /if: steps\.inspect\.outputs\.state != 'activated'[\s\S]*--resolved[\s\S]*if: steps\.inspect\.outputs\.state != 'activated'[\s\S]*npx prisma migrate deploy/u,
    );
    assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@v4/u);
    assert.doesNotMatch(
      workflow,
      /vercel|CASE_EVIDENCE|schedule:|CLOUDFLARE|revoke.*token/iu,
    );
  });
});

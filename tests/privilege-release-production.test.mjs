import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import yaml from "js-yaml";

import {
  privilegeRelease,
  verifyPrivilegeReleaseSource,
} from "../scripts/privilege-release-catalog.mjs";
import {
  verifyPrivateTablePreparationSource,
} from "../scripts/private-table-preparation-catalog.mjs";
import {
  classifyPrivilegeReleaseFunctions,
  inspectPrivilegeReleaseProduction,
} from "../scripts/privilege-release-production-inspect.mjs";

const releaseId = "service_reference_v1";
const release = privilegeRelease(releaseId);
const rootDir = join(import.meta.dirname, "..");
const stagedMigrationPath =
  process.env.SERVICE_REFERENCE_LEAST_PRIVILEGE_MIGRATION_PATH?.trim() ?? "";
const migrationPath = stagedMigrationPath !== ""
  ? stagedMigrationPath
  : join(rootDir, "prisma", "migrations", release.migration, "migration.sql");
const workflowPath = join(
  rootDir,
  ".github",
  "workflows",
  "privilege-release-production.yml",
);

function tableRows(posture, partial = false) {
  return Object.entries(release.tables)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([table, successor], index) => ({
      table_name: table,
      database_name: "grainline",
      current_user_name: "neondb_owner",
      session_user_name: "neondb_owner",
      table_owner_name: "neondb_owner",
      owner_bypasses_rls: true,
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      runtime_privileges: posture === "predecessor" || (partial && index === 0)
        ? ["DELETE", "INSERT", "SELECT", "UPDATE"]
        : successor,
      public_privileges: [],
      staff_privileges: [],
      runtime_grant_options: [],
      staff_grant_options: [],
      runtime_column_privileges: [],
      staff_column_privileges: [],
    }));
}

function fakeClientClass({ posture, recorded = false, partial = false }) {
  return class FakeClient {
    async connect() {}
    async end() {}

    async query(statement, parameters) {
      const sql = String(statement).trim();
      if (/^(?:BEGIN|COMMIT|ROLLBACK)/u.test(sql)) return { rows: [] };
      if (sql.includes("FROM pg_catalog.pg_class AS target")) {
        assert.deepEqual(parameters, [Object.keys(release.tables).sort()]);
        assert.match(
          sql,
          /pg_catalog\.aclexplode\(attribute\.attacl\)/u,
          "column ACL inspection must pass NULL through instead of constructing a zero-dimensional empty ACL array",
        );
        assert.doesNotMatch(
          sql,
          /pg_catalog\.aclexplode\(coalesce\(\s*attribute\.attacl/u,
          "PostgreSQL rejects zero-dimensional arrays passed to aclexplode",
        );
        return { rows: tableRows(posture, partial) };
      }
      if (sql.includes("FROM public._prisma_migrations")) {
        assert.deepEqual(parameters, [release.migration]);
        return { rows: recorded ? [{
          migration_name: release.migration,
          checksum: release.migrationSha256,
          finished_at: new Date("2026-11-01T12:00:00.000Z"),
          rolled_back_at: null,
          applied_steps_count: 0,
        }] : [] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 120)}`);
    }
  };
}

function environment(directory, phase, previousPath) {
  return {
    DIRECT_URL: "postgresql://owner:password@example.invalid:5432/grainline?sslmode=verify-full&channel_binding=require",
    PRIVILEGE_RELEASE_ID: releaseId,
    PRIVILEGE_RELEASE_PHASE: phase,
    PRIVILEGE_RELEASE_EVIDENCE_PATH: join(directory, `${phase}.json`),
    PRIVILEGE_RELEASE_PREVIOUS_EVIDENCE_PATH: previousPath,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: "c".repeat(40),
  };
}

async function inspect(directory, phase, clientOptions, previousPath) {
  return inspectPrivilegeReleaseProduction(
    environment(directory, phase, previousPath),
    {
      Client: fakeClientClass(clientOptions),
      rootDir,
      migrationPath,
    },
  );
}

test("catalog byte-seals the reviewed reusable privilege release", () => {
  assert.ok(isAbsolute(migrationPath));
  const verified = verifyPrivilegeReleaseSource(releaseId, rootDir, migrationPath);
  assert.equal(verified.digest, release.migrationSha256);
  assert.deepEqual(release.sourceTests, [
    "tests/service-reference-least-privilege.test.mjs",
  ]);
  assert.deepEqual(release.laterPendingMigrations, [
    "20261101080000_prepare_email_service_least_privilege",
  ]);
  assert.equal(
    release.minimumCompatibleAppCommit,
    "b56e226d327347fe155aa07ded0bde999ca929be",
  );
  assert.deepEqual(release.tables, {
    FoundingMakerGrant: ["SELECT"],
    Metro: ["INSERT", "SELECT", "UPDATE"],
    SiteConfig: ["SELECT"],
    SiteMetricsSnapshot: ["INSERT", "SELECT", "UPDATE"],
    SystemAuditLog: ["INSERT", "SELECT"],
  });
  assert.throws(() => privilegeRelease("unreviewed"), /release id is not reviewed/u);
});

test("catalog byte-seals the reviewed email-service activation boundary", () => {
  const emailRelease = privilegeRelease("email_service_v1");
  const stagedMigrationPath =
    process.env.EMAIL_SERVICE_LEAST_PRIVILEGE_ACTIVATION_MIGRATION_PATH;
  const verified = verifyPrivilegeReleaseSource(
    "email_service_v1",
    rootDir,
    stagedMigrationPath || undefined,
  );
  assert.equal(verified.digest, emailRelease.migrationSha256);
  assert.equal(verified.rollbackDigest, emailRelease.rollback.sha256);
  assert.equal(
    emailRelease.preparationMigration.name,
    "20261101080000_prepare_email_service_least_privilege",
  );
  assert.equal(
    emailRelease.preparationMigration.sha256,
    "a00d71f078a8e2cb38d376292592011861904b77a9ba282e186669a8d142e803",
  );
  assert.equal(
    emailRelease.minimumCompatibleAppCommit,
    "d6e576aff2838df4c773119ad63252ba1c63d232",
  );
  assert.deepEqual(emailRelease.emptyTables, ["EmailFailureCount"]);
  assert.deepEqual(emailRelease.laterPendingMigrations, []);
  assert.deepEqual(emailRelease.predecessorRuntimeFunctions, [
    "public.grainline_account_deletion_email_key_core(text)",
  ]);
  assert.deepEqual(Object.keys(emailRelease.functions).sort(), [
    "public.grainline_email_account_deletion_suppression_clear(text)",
    "public.grainline_email_hard_suppression_apply(text,text,\"EmailSuppressionReason\",text,text,jsonb)",
    "public.grainline_email_one_click_suppression_clear(text)",
    "public.grainline_email_outbox_account_deletion_fence(text,text[])",
    "public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)",
    "public.grainline_email_outbox_cancel_seller_broadcast(text)",
    "public.grainline_email_outbox_claim_batch(integer)",
    "public.grainline_email_outbox_claim_one(text)",
    "public.grainline_email_outbox_complete(text,bigint,uuid,text)",
    "public.grainline_email_outbox_defer(text,bigint,uuid,text)",
    "public.grainline_email_outbox_enqueue_legacy(text,text,text,text,text,integer,text,text,text,text,text)",
    "public.grainline_email_outbox_fail(text,bigint,uuid,text,text)",
    "public.grainline_email_outbox_redact_deleted_seller(text)",
    "public.grainline_email_outbox_retention_delete_batch(timestamp without time zone,timestamp without time zone,integer)",
    "public.grainline_email_outbox_skip(text,bigint,uuid,text)",
    "public.grainline_email_service_account_deletion_apply(text,bigint,uuid)",
    "public.grainline_email_service_ops_health(timestamp without time zone,timestamp without time zone)",
    "public.grainline_email_service_owner_export()",
    "public.grainline_email_suppression_exists(text,text)",
    "public.grainline_email_unsubscribe_apply(text,jsonb)",
    "public.grainline_newsletter_confirm(text,timestamp without time zone)",
    "public.grainline_newsletter_confirmation_valid(text,timestamp without time zone)",
    "public.grainline_newsletter_expired_unconfirmed_delete_batch(timestamp without time zone,integer)",
    "public.grainline_newsletter_signup_release(text,text)",
    "public.grainline_newsletter_signup_reserve(text,text,text,timestamp without time zone,timestamp without time zone,timestamp without time zone)",
    "public.grainline_newsletter_token_superseded(text,timestamp without time zone)",
    "public.grainline_resend_webhook_event_complete(text,bigint,uuid,timestamp without time zone)",
    "public.grainline_resend_webhook_event_fail(text,bigint,uuid,text,timestamp without time zone)",
    "public.grainline_resend_webhook_event_reserve(text,text,timestamp without time zone,timestamp without time zone,uuid)",
    "public.grainline_resend_webhook_event_retention_delete_batch(timestamp without time zone,integer)",
  ]);
  assert.deepEqual(emailRelease.tables, {
    EmailFailureCount: [],
    EmailOutbox: [],
    EmailSuppression: [],
    NewsletterSubscriber: [],
    ResendWebhookEvent: [],
  });
  assert.deepEqual(
    emailRelease.functions[
      "public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)"
    ],
    [
      "acb3d41117e8b8a88fbe3fd055cdc1824b8a32eaebf4f40fb687c8ef7516289e",
      "ef145be432a0ffcbbf02e6dc9419d90d7b0ec3dec23a9d1eb0a83aff0a16393a",
      "52ae9eafd81f3776610dbc066de0364b134086f0f2b46cd45db290e00bec4ef8",
    ],
  );
});

test("email activation pins every function body installed by its preparation", () => {
  const emailRelease = privilegeRelease("email_service_v1");
  const preparation = verifyPrivateTablePreparationSource(
    "email_service_v1",
    rootDir,
  );
  for (const entry of preparation.release.functions) {
    const argumentsSql = entry.arguments.replace(/,\s+/gu, ",");
    const signature = `public.${entry.name}(${argumentsSql})`;
    const source = preparation.functionSources.get(entry.name);
    assert.equal(typeof source, "string", `${signature} preparation source is missing`);
    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    const reviewedSources = Array.isArray(emailRelease.functions[signature])
      ? emailRelease.functions[signature]
      : [emailRelease.functions[signature]];
    assert.ok(
      reviewedSources.includes(sourceSha256),
      `${signature} activation source pin drifted from preparation`,
    );
  }
});

test("production inspector retires predecessor-only function authority with the table boundary", () => {
  const inspectorSource = readFileSync(
    join(rootDir, "scripts", "privilege-release-production-inspect.mjs"),
    "utf8",
  );
  assert.match(
    inspectorSource,
    /ORDER BY expected\.signature COLLATE "C"/u,
    "function evidence order must not depend on the Production database collation",
  );
  const source = "BEGIN RETURN 1; END";
  const digest = createHash("sha256").update(source).digest("hex");
  const laterSource = "BEGIN RETURN 2; END";
  const laterDigest = createHash("sha256").update(laterSource).digest("hex");
  const mockRelease = {
    functions: {
      "public.retained()": [digest, laterDigest],
    },
    predecessorRuntimeFunctions: ["public.compat(text)"],
  };
  const row = (signature, runtimeExecute, rowSource = source) => ({
    signature,
    exists: true,
    source: rowSource,
    security_definer: true,
    configuration: ["search_path=pg_catalog"],
    owner_bypasses_rls: true,
    public_execute: false,
    runtime_execute: runtimeExecute,
  });
  const predecessorRows = [
    row("public.retained()", true),
    row("public.compat(text)", true),
  ];
  const predecessor = classifyPrivilegeReleaseFunctions(
    predecessorRows,
    mockRelease,
    "predecessor",
  );
  assert.equal(predecessor[0].predecessorOnly, true);
  assert.equal(predecessor[0].runtimeExecute, true);

  const successorRows = [
    row("public.compat(text)", false),
    row("public.retained()", true),
  ];
  const successor = classifyPrivilegeReleaseFunctions(
    successorRows,
    mockRelease,
    "successor",
  );
  assert.equal(successor[0].predecessorOnly, true);
  assert.equal(successor[0].runtimeExecute, false);
  const laterSuccessor = classifyPrivilegeReleaseFunctions(
    [
      row("public.compat(text)", false),
      row("public.retained()", true, laterSource),
    ],
    mockRelease,
    "successor",
  );
  assert.equal(laterSuccessor[1].sourceSha256, laterDigest);
  const retiredSuccessor = classifyPrivilegeReleaseFunctions(
    [
      row("public.compat(text)", false),
      row("public.retained()", false, laterSource),
    ],
    mockRelease,
    "successor",
    new Set(["public.retained()"]),
  );
  assert.equal(retiredSuccessor[1].runtimeExecute, false);
  assert.throws(
    () => classifyPrivilegeReleaseFunctions(
      predecessorRows,
      mockRelease,
      "successor",
    ),
    /public\.compat\(text\) runtime EXECUTE drifted/u,
  );
  assert.throws(
    () => classifyPrivilegeReleaseFunctions(
      [
        row("public.compat(text)", false),
        row("public.retained()", true, "BEGIN RETURN 3; END"),
      ],
      mockRelease,
      "successor",
    ),
    /public\.retained\(\) source drifted/u,
  );
});

test("production inspector recognizes all three restart-safe release states", async () => {
  const directory = mkdtempSync(join(tmpdir(), "grainline-privilege-release-"));
  try {
    const pending = await inspect(directory, "preflight", {
      posture: "predecessor",
    });
    assert.equal(pending.state, "pending");
    assert.equal(pending.catalog.posture, "predecessor");
    assert.equal(statSync(join(directory, "preflight.json")).mode & 0o777, 0o600);

    rmSync(join(directory, "preflight.json"));
    const unrecorded = await inspect(directory, "preflight", {
      posture: "successor",
    });
    assert.equal(unrecorded.state, "applied_unrecorded");

    rmSync(join(directory, "preflight.json"));
    const applied = await inspect(directory, "preflight", {
      posture: "successor",
      recorded: true,
    });
    assert.equal(applied.state, "applied");
    const postflight = await inspect(
      directory,
      "postflight",
      { posture: "successor", recorded: true },
      join(directory, "preflight.json"),
    );
    assert.equal(postflight.state, "applied");
    const evidence = JSON.parse(readFileSync(join(directory, "postflight.json"), "utf8"));
    assert.equal(evidence.containsRowData, false);
    assert.equal(evidence.productionChanged, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production inspector rejects partial privileges and false ledger claims", async () => {
  const partialDirectory = mkdtempSync(join(tmpdir(), "grainline-privilege-partial-"));
  const ledgerDirectory = mkdtempSync(join(tmpdir(), "grainline-privilege-ledger-"));
  try {
    await assert.rejects(
      inspect(partialDirectory, "preflight", {
        posture: "successor",
        partial: true,
      }),
      /privilege release is partially applied/u,
    );
    await assert.rejects(
      inspect(ledgerDirectory, "preflight", {
        posture: "predecessor",
        recorded: true,
      }),
      /applied release posture drifted/u,
    );
  } finally {
    rmSync(partialDirectory, { recursive: true, force: true });
    rmSync(ledgerDirectory, { recursive: true, force: true });
  }
});

test("workflow is exact-main, serialized, restart-safe, and evidence preserving", () => {
  const source = readFileSync(workflowPath, "utf8");
  const parsed = yaml.load(source, { schema: yaml.JSON_SCHEMA });
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.equal(parsed.concurrency["cancel-in-progress"], false);
  assert.deepEqual(
    parsed.on.workflow_dispatch.inputs.release_id.options,
    ["email_service_v1", releaseId],
  );
  assert.match(source, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(source, /main\.commit\.sha !== sha/u);
  assert.match(source, /Exact-main push workflows are not all green/u);
  assert.match(source, /Compatible app predates the reviewed privilege minimum/u);
  assert.match(source, /Compatible app commit is not an ancestor of privilege release/u);
  assert.match(source, /Compatible app does not succeed the reviewed predecessor/u);
  assert.match(source, /verify-order-email-free-deployment-surface\.mjs/u);
  assert.match(source, /guard-production-migration-runner\.mjs/u);
  assert.match(source, /assert-reviewed-pending-migrations\.mjs/u);
  assert.match(source, /assert-reviewed-migration-tail\.mjs/u);
  assert.match(source, /--later-pending-migrations/u);
  assert.match(source, /steps\.preflight\.outputs\.expected_pending/u);
  assert.match(source, /steps\.preflight\.outputs\.later_pending/u);
  assert.match(
    source,
    /if \[ "\$\{#later_pending\[@\]\}" -gt 0 \]; then/u,
  );
  assert.match(source, /steps\.preflight\.outputs\.state == 'pending'/u);
  assert.match(source, /steps\.preflight\.outputs\.state != 'applied'/u);
  assert.match(source, /prisma migrate resolve --applied/u);
  assert.match(source, /audit:db-grants -- --require-direct-url/u);
  assert.match(source, /if: always\(\)[\s\S]*if-no-files-found: error/u);
  for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)) {
    assert.match(match[1], /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/u);
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_POSTFLIGHT_CONFIRMATION,
  assertOrderPaymentEventReadAuthorityPostflightGitState,
  parseOrderPaymentEventReadAuthorityPostflightConfig,
  proveOrderPaymentEventReadAuthorityRuntimeBoundaries,
  writeOrderPaymentEventReadAuthorityPostflightEvidence,
} from "../scripts/order-payment-event-read-authority-production-postflight.mjs";

const COMMIT = "a".repeat(40);
const REVIEWED_IDENTITY = Object.freeze({
  databaseName: "grainline",
  endpointId: "reviewed-endpoint",
  region: "aws-us-east-2",
  role: "grainline_app_runtime",
  runtimeRole: "grainline_app_runtime",
});

function environment(evidencePath) {
  return {
    NODE_ENV: "production",
    ORDER_PAYMENT_EVENT_READ_AUTHORITY_POSTFLIGHT_CONFIRM:
      ORDER_PAYMENT_EVENT_READ_AUTHORITY_POSTFLIGHT_CONFIRMATION,
    ORDER_PAYMENT_EVENT_READ_AUTHORITY_POSTFLIGHT_RELEASE_COMMIT: COMMIT,
    ORDER_PAYMENT_EVENT_READ_AUTHORITY_POSTFLIGHT_MAIN_CI_RUN_ID: "101",
    ORDER_PAYMENT_EVENT_READ_AUTHORITY_POSTFLIGHT_INVARIANT_MIGRATION_RUN_ID:
      "102",
    ORDER_PAYMENT_EVENT_READ_AUTHORITY_POSTFLIGHT_READ_MIGRATION_RUN_ID: "103",
    ORDER_PAYMENT_EVENT_READ_AUTHORITY_POSTFLIGHT_EVIDENCE_PATH: evidencePath,
    DATABASE_URL: "postgresql://grainline_app_runtime:secret@example.com/grainline",
  };
}

test("read-authority postflight accepts exact runtime-only bindings", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ope-read-postflight-"));
  const evidencePath = path.join(
    directory,
    `order-payment-event-read-authority-production-postflight-${COMMIT}.json`,
  );
  const config = parseOrderPaymentEventReadAuthorityPostflightConfig(
    environment(evidencePath),
    { assertRuntimeDatabaseIsolation: () => REVIEWED_IDENTITY },
  );
  assert.equal(config.releaseCommit, COMMIT);
  assert.equal(config.mainCiRunId, 101);
  assert.equal(config.invariantMigrationRunId, 102);
  assert.equal(config.readMigrationRunId, 103);
  assert.equal(config.runtimeIdentity, REVIEWED_IDENTITY);
  assert.equal(config.evidencePath, evidencePath);
});

test("read-authority postflight rejects privileged aliases and stale evidence", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ope-read-postflight-"));
  const evidencePath = path.join(
    directory,
    `order-payment-event-read-authority-production-postflight-${COMMIT}.json`,
  );
  const dependencies = {
    assertRuntimeDatabaseIsolation: () => REVIEWED_IDENTITY,
  };
  assert.throws(() => parseOrderPaymentEventReadAuthorityPostflightConfig(
    { ...environment(evidencePath), DIRECT_URL: "postgresql://owner:secret@example.com/db" },
    dependencies,
  ));
  assert.throws(() => parseOrderPaymentEventReadAuthorityPostflightConfig(
    { ...environment(evidencePath), DATABASE_URL_COPY: environment(evidencePath).DATABASE_URL },
    dependencies,
  ));
  writeOrderPaymentEventReadAuthorityPostflightEvidence(evidencePath, {
    status: "occupied",
  });
  assert.throws(() => parseOrderPaymentEventReadAuthorityPostflightConfig(
    environment(evidencePath),
    dependencies,
  ));
});

test("read-authority postflight requires exact clean Git state", () => {
  assert.deepEqual(
    assertOrderPaymentEventReadAuthorityPostflightGitState(
      { head: COMMIT, status: "" },
      COMMIT,
    ),
    { clean: true, head: COMMIT },
  );
  assert.throws(() => assertOrderPaymentEventReadAuthorityPostflightGitState(
    { head: "b".repeat(40), status: "" },
    COMMIT,
  ));
  assert.throws(() => assertOrderPaymentEventReadAuthorityPostflightGitState(
    { head: COMMIT, status: " M file" },
    COMMIT,
  ));
});

test("read-authority postflight probes only absent projections and expected denial", async () => {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.startsWith("SAVEPOINT") || sql.startsWith("ROLLBACK TO") || sql.startsWith("RELEASE")) {
        return { rows: [] };
      }
      if (sql.includes("grainline_order_payment_staff_timeline")) {
        const error = new Error("denied");
        error.code = "42501";
        throw error;
      }
      if (sql.includes("count(*)")) return { rows: [{ count: 0 }] };
      return { rows: [] };
    },
  };
  const result = await proveOrderPaymentEventReadAuthorityRuntimeBoundaries(client);
  assert.deepEqual(result, { projectionCount: 5 });
  assert.equal(
    queries.filter(({ sql }) => sql.includes("grainline_order_payment_")).length,
    5,
  );
  assert.ok(queries.every(({ values }) => !values.some((value) => (
    typeof value === "string" && value.startsWith("postgres")
  ))));
});

test("read-authority evidence is fresh, sanitized and mode 0600", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ope-read-postflight-"));
  const evidencePath = path.join(directory, "evidence.json");
  writeOrderPaymentEventReadAuthorityPostflightEvidence(evidencePath, {
    status: "passed",
    rowsExported: false,
  });
  assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(evidencePath, "utf8")), {
    status: "passed",
    rowsExported: false,
  });
  assert.throws(() => writeOrderPaymentEventReadAuthorityPostflightEvidence(
    evidencePath,
    { status: "overwritten" },
  ));
});

test("read-authority postflight source pins read-only behavior and output safety", () => {
  const source = readFileSync(
    "scripts/order-payment-event-read-authority-production-postflight.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source, /transaction_read_only/);
  assert.match(source, /postgresChannelBindingClientOptions/);
  assert.match(source, /rowsExported: false/);
  assert.match(source, /privilegedDatabaseEnvironmentKeys/);
  assert.match(source, /unreviewedPostgresUrlEnvironmentKeys/);
  assert.doesNotMatch(source, /INSERT INTO|UPDATE public|DELETE FROM|ALTER TABLE/);
  assert.doesNotMatch(source, /console\.log\(.*databaseUrl/s);
});

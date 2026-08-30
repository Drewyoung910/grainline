import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseOrderPaymentEventReadAuthorityCiScopeEnvironment,
} from "../scripts/order-payment-event-read-authority-ci-scope-proof.mjs";

const validEnvironment = Object.freeze({
  GITHUB_ACTIONS: "true",
  GITHUB_WORKFLOW: "CI",
  GITHUB_EVENT_NAME: "pull_request",
  DIRECT_URL:
    "postgresql://ci:secret@localhost:5432/grainline_ci?sslmode=disable",
});

test("read-authority CI scope accepts only the disposable CI identity", () => {
  assert.deepEqual(
    parseOrderPaymentEventReadAuthorityCiScopeEnvironment(validEnvironment),
    { directUrl: validEnvironment.DIRECT_URL },
  );
  assert.deepEqual(
    parseOrderPaymentEventReadAuthorityCiScopeEnvironment({
      ...validEnvironment,
      GITHUB_EVENT_NAME: "push",
    }),
    { directUrl: validEnvironment.DIRECT_URL },
  );
});

test("read-authority CI scope rejects non-CI and non-loopback databases", () => {
  for (const environment of [
    { ...validEnvironment, GITHUB_ACTIONS: "false" },
    { ...validEnvironment, GITHUB_WORKFLOW: "Production Migrations" },
    { ...validEnvironment, GITHUB_EVENT_NAME: "workflow_dispatch" },
    {
      ...validEnvironment,
      DIRECT_URL:
        "postgresql://neondb_owner:secret@example.com/grainline?sslmode=require",
    },
    {
      ...validEnvironment,
      DIRECT_URL:
        "postgresql://grainline_app_runtime:secret@localhost:5432/grainline_ci?sslmode=disable",
    },
    {
      ...validEnvironment,
      DIRECT_URL:
        "postgresql://ci:secret@localhost:5432/grainline?sslmode=disable",
    },
  ]) {
    assert.throws(() => (
      parseOrderPaymentEventReadAuthorityCiScopeEnvironment(environment)
    ));
  }
});

test("read-authority CI scope is engine-read-only and role-pinned", () => {
  const source = readFileSync(
    "scripts/order-payment-event-read-authority-ci-scope-proof.mjs",
    "utf8",
  );
  assert.match(
    source,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
  );
  assert.match(source, /transaction_read_only/);
  assert.match(source, /current_user AS role, current_database\(\) AS database/);
  assert.match(source, /migrationRole: CI_MIGRATION_ROLE/);
  assert.doesNotMatch(source, /INSERT INTO|UPDATE public|DELETE FROM|ALTER TABLE/);
});

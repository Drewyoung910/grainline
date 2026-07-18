import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SAVED_SEARCH_RLS_MIGRATION,
  SAVED_SEARCH_RPC_MIGRATION,
  validateSavedSearchRlsDeployShape,
} from "../scripts/guard-saved-search-rls-deploy.mjs";

const RELEASE_ZERO = "release-0";
const REVIEWED_PHASE_A = "phase-a-reviewed";

function validate(phase, migrationNames) {
  return validateSavedSearchRlsDeployShape({ phase, migrationNames });
}

describe("SavedSearch RLS production deploy guard", () => {
  it("fails the current rollout tree without explicit phase authorization", () => {
    const currentMigrations = readdirSync("prisma/migrations", {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    assert.ok(currentMigrations.includes(SAVED_SEARCH_RPC_MIGRATION));
    assert.throws(() => validate(undefined, currentMigrations), /is missing/);
    if (currentMigrations.includes(SAVED_SEARCH_RLS_MIGRATION)) {
      assert.throws(
        () => validate(RELEASE_ZERO, currentMigrations),
        /requires .* to be absent/,
      );
      assert.equal(
        validate(REVIEWED_PHASE_A, currentMigrations).phase,
        REVIEWED_PHASE_A,
      );
    } else {
      assert.equal(validate(RELEASE_ZERO, currentMigrations).phase, RELEASE_ZERO);
      assert.throws(
        () => validate(REVIEWED_PHASE_A, currentMigrations),
        /requires both/,
      );
    }
  });

  it("allows release 0 only when the RPC migration exists and the RLS migration is absent", () => {
    assert.deepEqual(validate(RELEASE_ZERO, [SAVED_SEARCH_RPC_MIGRATION]), {
      phase: RELEASE_ZERO,
      hasRpcMigration: true,
      hasRlsMigration: false,
    });

    assert.throws(() => validate(RELEASE_ZERO, []), /requires/);
    assert.throws(
      () => validate(RELEASE_ZERO, [SAVED_SEARCH_RLS_MIGRATION]),
      /requires/,
    );
    assert.throws(
      () => validate(RELEASE_ZERO, [
        SAVED_SEARCH_RPC_MIGRATION,
        SAVED_SEARCH_RLS_MIGRATION,
      ]),
      /to be absent/,
    );
  });

  it("allows reviewed phase A only when both rollout migrations exist", () => {
    assert.deepEqual(
      validate(REVIEWED_PHASE_A, [
        SAVED_SEARCH_RPC_MIGRATION,
        SAVED_SEARCH_RLS_MIGRATION,
      ]),
      {
        phase: REVIEWED_PHASE_A,
        hasRpcMigration: true,
        hasRlsMigration: true,
      },
    );

    assert.throws(() => validate(REVIEWED_PHASE_A, []), /requires both/);
    assert.throws(
      () => validate(REVIEWED_PHASE_A, [SAVED_SEARCH_RPC_MIGRATION]),
      /requires both/,
    );
    assert.throws(
      () => validate(REVIEWED_PHASE_A, [SAVED_SEARCH_RLS_MIGRATION]),
      /requires both/,
    );
  });

  it("fails closed for missing, empty, or unknown phase values", () => {
    const bothMigrations = [
      SAVED_SEARCH_RPC_MIGRATION,
      SAVED_SEARCH_RLS_MIGRATION,
    ];

    assert.throws(() => validate(undefined, bothMigrations), /is missing/);
    assert.throws(() => validate("", bothMigrations), /is missing/);
    assert.throws(() => validate("phase-a", bothMigrations), /expected/);
    assert.throws(() => validate("release-1", bothMigrations), /expected/);
  });

  it("requires the reviewed phase migration to remain latest", () => {
    const laterMigration = "20260717040000_force_saved_search_rls";

    assert.throws(
      () => validate(RELEASE_ZERO, [SAVED_SEARCH_RPC_MIGRATION, laterMigration]),
      /remain the latest migration/,
    );
    assert.throws(
      () => validate(REVIEWED_PHASE_A, [
        SAVED_SEARCH_RPC_MIGRATION,
        SAVED_SEARCH_RLS_MIGRATION,
        laterMigration,
      ]),
      /review or retire the temporary SavedSearch deploy guard/,
    );
  });

  it("runs the guard before production migrations without affecting preview builds", () => {
    const { buildCommand } = JSON.parse(readFileSync("vercel.json", "utf8"));
    const productionConditional =
      'if [ "$VERCEL_ENV" = "production" ]; then';
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const guardedMigrationCommand = "npm run migrate:deploy:guarded";
    const buildCommandText = "npm run build";

    assert.equal(
      pkg.scripts["migrate:deploy:guarded"],
      "node scripts/guard-saved-search-rls-deploy.mjs && prisma migrate deploy",
    );
    assert.ok(buildCommand.startsWith(productionConditional));
    assert.ok(
      buildCommand.indexOf(guardedMigrationCommand)
        > buildCommand.indexOf(productionConditional),
    );
    assert.match(
      buildCommand,
      /then npm run migrate:deploy:guarded; fi && npm run build$/,
    );
    assert.ok(buildCommand.indexOf(buildCommandText) > buildCommand.indexOf("; fi"));
  });

  it("keeps the human promotion meaning of both phase values documented", () => {
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
    }

    const runbook = readFileSync("docs/runbook.md", "utf8");
    assert.match(runbook, /explicit\s+human promotion authorization/);
    assert.match(runbook, /Never\s+use it to bypass the guard/);
  });
});

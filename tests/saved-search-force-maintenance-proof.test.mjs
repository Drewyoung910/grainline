import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseForceMaintenanceProofConfig,
} from "../scripts/saved-search-force-maintenance-proof.mjs";

const DIRECT_URL =
  "postgresql://neondb_owner:owner-secret@ep-staging.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function validEnv(overrides = {}) {
  return {
    SAVED_SEARCH_FORCE_PROOF_CONFIRM: "staging-only",
    SAVED_SEARCH_FORCE_PROOF_DIRECT_URL: DIRECT_URL,
    SAVED_SEARCH_FORCE_PROOF_EXPECTED_DATABASE_ENDPOINT_ID: "ep-staging",
    SAVED_SEARCH_FORCE_PROOF_PRODUCTION_DATABASE_ENDPOINT_ID: "ep-production",
    SAVED_SEARCH_FORCE_PROOF_EXPECTED_DATABASE_NAME: "neondb",
    SAVED_SEARCH_FORCE_PROOF_EXPECTED_DATABASE_REGION: "westus3.azure",
    SAVED_SEARCH_FORCE_PROOF_EVIDENCE_PATH: "/tmp/force-proof.json",
    ...overrides,
  };
}

describe("SavedSearch Phase B owner maintenance proof", () => {
  it("requires an independently identified direct staging owner target", () => {
    const parsed = parseForceMaintenanceProofConfig(validEnv());
    assert.equal(parsed.databaseName, "neondb");
    assert.equal(parsed.endpointId, "ep-staging");
    assert.equal(parsed.username, "neondb_owner");

    assert.throws(
      () => parseForceMaintenanceProofConfig(validEnv({
        SAVED_SEARCH_FORCE_PROOF_CONFIRM: "",
      })),
      /staging-only is required/,
    );
    assert.throws(
      () => parseForceMaintenanceProofConfig(validEnv({
        SAVED_SEARCH_FORCE_PROOF_PRODUCTION_DATABASE_ENDPOINT_ID: "ep-staging",
      })),
      /staging endpoint must differ from production/,
    );
    assert.throws(
      () => parseForceMaintenanceProofConfig(validEnv({
        SAVED_SEARCH_FORCE_PROOF_DIRECT_URL: DIRECT_URL.replace(
          "ep-staging.",
          "ep-staging-pooler.",
        ),
      })),
      /must use a direct endpoint/,
    );
    assert.throws(
      () => parseForceMaintenanceProofConfig(validEnv({
        SAVED_SEARCH_FORCE_PROOF_DIRECT_URL: DIRECT_URL.replace(
          "neondb_owner",
          "grainline_app_runtime",
        ),
      })),
      /must authenticate as neondb_owner/,
    );
    assert.throws(
      () => parseForceMaintenanceProofConfig(validEnv({ PGOPTIONS: "-c role=other" })),
      /must not inherit .*PGOPTIONS/,
    );
  });

  it("keeps disable, maintenance, restore, verification, and rollback in bounded staging transactions", () => {
    const source = readFileSync(
      "scripts/saved-search-force-maintenance-proof.mjs",
      "utf8",
    );
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));

    assert.equal(
      pkg.scripts["audit:rls-saved-search-force"],
      "node scripts/saved-search-force-maintenance-proof.mjs",
    );
    assert.match(source, /SET LOCAL lock_timeout = '5s'/);
    assert.match(source, /SET LOCAL statement_timeout = '30s'/);
    assert.match(source, /ALTER TABLE public\."SavedSearch" DISABLE ROW LEVEL SECURITY/);
    assert.match(source, /ALTER TABLE public\."SavedSearch" ENABLE ROW LEVEL SECURITY/);
    assert.match(source, /ALTER TABLE public\."SavedSearch" FORCE ROW LEVEL SECURITY/);
    assert.match(source, /NOSUPERUSER BYPASSRLS service role/);
    assert.match(source, /ownerBypassRoleVerified: true/);
    assert.match(source, /reversibleOwnerMaintenanceUnderForce: true/);
    assert.match(source, /emergencyDisableRestoreVerified: true/);
    assert.match(source, /rollbackRemovedFixture: true/);
    assert.match(source, /finalForceRestored: true/);
    assert.match(source, /writeFileSync\([\s\S]*mode: 0o600/);
    assert.match(source, /chmodSync\([\s\S]*0o600/);
    assert.doesNotMatch(source, /client\.query\("COMMIT"\)/);
    assert.ok((source.match(/client\.query\("ROLLBACK"\)/g) ?? []).length >= 2);
  });
});

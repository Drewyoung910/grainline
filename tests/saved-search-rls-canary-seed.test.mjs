import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  parseCanarySeedConfig,
  writeCanarySeedEvidence,
} from "../scripts/seed-saved-search-rls-canary.mjs";

const NONCE = "0123456789abcdef";
const BASE_ENV = {
  SAVED_SEARCH_RLS_CANARY_SEED_CONFIRM: "reviewed-permanent-canary",
  SAVED_SEARCH_RLS_CANARY_SEED_DATABASE_URL:
    "postgresql://grainline_app_runtime:runtime-secret@ep-grainline-staging-pooler.us-east-2.aws.neon.tech/grainline_staging",
  SAVED_SEARCH_RLS_CANARY_SEED_ADMIN_DATABASE_URL:
    "postgresql://grainline_migration_owner:owner-secret@ep-grainline-staging.us-east-2.aws.neon.tech/grainline_staging",
  SAVED_SEARCH_RLS_CANARY_SEED_EXPECTED_DATABASE_ENDPOINT_ID:
    "ep-grainline-staging",
  SAVED_SEARCH_RLS_CANARY_SEED_EXPECTED_DATABASE_NAME: "grainline_staging",
  SAVED_SEARCH_RLS_CANARY_SEED_EXPECTED_DATABASE_REGION: "us-east-2.aws",
  SAVED_SEARCH_RLS_CANARY_SEED_EVIDENCE_PATH:
    "/private/tmp/saved-search-canary-seed.json",
  SAVED_SEARCH_RLS_CANARY_USER_ID:
    `rls-saved-search-canary-${NONCE}-user`,
  SAVED_SEARCH_RLS_CANARY_SEARCH_ID:
    `rls-saved-search-canary-${NONCE}-search`,
};

describe("SavedSearch RLS permanent canary seeding", () => {
  it("requires reviewed identity, role separation, transport, and one paired nonce", () => {
    const config = parseCanarySeedConfig(BASE_ENV);
    assert.equal(config.endpointId, "ep-grainline-staging");
    assert.equal(config.databaseName, "grainline_staging");
    assert.equal(config.region, "us-east-2.aws");
    assert.match(config.clerkId, /^rls-canary:[a-f0-9]+$/);
    assert.match(config.email, /@example\.invalid$/);

    for (const override of [
      { SAVED_SEARCH_RLS_CANARY_SEED_CONFIRM: "yes" },
      {
        SAVED_SEARCH_RLS_CANARY_SEED_DATABASE_URL:
          BASE_ENV.SAVED_SEARCH_RLS_CANARY_SEED_DATABASE_URL.replace("-pooler", ""),
      },
      {
        SAVED_SEARCH_RLS_CANARY_SEARCH_ID:
          "rls-saved-search-canary-fedcba987654-search",
      },
      {
        SAVED_SEARCH_RLS_CANARY_SEED_EXPECTED_DATABASE_ENDPOINT_ID:
          "ep-somewhere-else",
      },
    ]) {
      assert.throws(() => parseCanarySeedConfig({ ...BASE_ENV, ...override }));
    }
  });

  it("writes mode-0600 evidence without ids, emails, URLs, or credentials", () => {
    const directory = mkdtempSync(join(tmpdir(), "saved-search-canary-seed-"));
    try {
      const evidencePath = join(directory, "evidence.json");
      const config = parseCanarySeedConfig({
        ...BASE_ENV,
        SAVED_SEARCH_RLS_CANARY_SEED_EVIDENCE_PATH: evidencePath,
      });
      const payload = writeCanarySeedEvidence(
        config,
        { rlsEnabled: false, rlsForced: false, status: "healthy" },
        "2026-07-17T18:00:00.000Z",
      );
      const serialized = readFileSync(evidencePath, "utf8");
      assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
      assert.equal(payload.result.status, "healthy");
      assert.equal(payload.result.issueCount, 0);
      assert.doesNotMatch(serialized, /rls-saved-search-canary/);
      assert.doesNotMatch(serialized, /example\.invalid/);
      assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\//);
      assert.doesNotMatch(serialized, /secret/);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("pins banned/no-email synthetic attributes and pooled context cleanup", () => {
    const source = readFileSync(
      "scripts/seed-saved-search-rls-canary.mjs",
      "utf8",
    );
    assert.match(source, /banned,[\s\S]*true, now\(\)/);
    assert.match(source, /"notifyEmail", "createdAt"\)[\s\S]*false, now\(\)/);
    assert.match(source, /SELECT set_config\('app\.user_id', \$1, true\)/);
    assert.match(source, /current_setting\('app\.user_id', true\)/);
    assert.match(source, /runtime canary context leaked after commit/);
  });
});

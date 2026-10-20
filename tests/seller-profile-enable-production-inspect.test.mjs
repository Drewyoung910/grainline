import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SELLER_PROFILE_ENABLE,
  SELLER_PROFILE_PREPARATION,
  inspectSellerProfileEnableProduction,
} from "../scripts/seller-profile-enable-production-inspect.mjs";

const releaseCommit = "a".repeat(40);

function accepted(name, checksum) {
  return {
    migration_name: name,
    checksum,
    finished_at: "2026-10-19T12:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function fakeClientClass({ enabled = false } = {}) {
  return class FakeClient {
    constructor({ connectionString }) {
      assert.equal(connectionString, "postgresql://example.invalid/grainline");
    }

    async connect() {}
    async end() {}

    async query(statement) {
      const sql = String(statement);
      if (/^(?:BEGIN|COMMIT|ROLLBACK)/u.test(sql.trim())) return { rows: [] };
      if (sql.includes("current_database() AS database_name")) {
        return { rows: [{
          database_name: "grainline",
          current_user_name: "neondb_owner",
          session_user_name: "neondb_owner",
          table_owner_name: "neondb_owner",
          owner_bypassrls: true,
        }] };
      }
      if (sql.includes("FROM public._prisma_migrations")) {
        return { rows: [
          accepted(SELLER_PROFILE_PREPARATION.name, SELLER_PROFILE_PREPARATION.checksum),
          ...(enabled
            ? [accepted(SELLER_PROFILE_ENABLE.name, SELLER_PROFILE_ENABLE.checksum)]
            : []),
        ] };
      }
      if (sql.includes("AS public_rls")) {
        return { rows: [{
          public_rls: enabled,
          public_force: false,
          public_policy_count: 0,
          private_rls: true,
          private_force: true,
          private_policy_count: 0,
          restricted_role_count: 2,
          runtime_crud_grant_count: enabled ? 0 : 4,
          nonowner_table_grant_count: enabled ? 0 : 4,
          nonowner_column_grant_count: 0,
          private_nonowner_table_grant_count: 0,
          private_nonowner_column_grant_count: 0,
          runtime_column_authority: !enabled,
          staff_column_authority: false,
        }] };
      }
      throw new Error(`unexpected inspector query: ${sql.slice(0, 120)}`);
    }
  };
}

function environment(directory, expectedState) {
  return {
    DIRECT_URL: "postgresql://example.invalid/grainline",
    SELLER_PROFILE_ENABLE_EXPECTED_STATE: expectedState,
    SELLER_PROFILE_ENABLE_EVIDENCE_PATH: join(directory, `${expectedState}.json`),
    SELLER_PROFILE_ENABLE_RELEASE_COMMIT: releaseCommit,
  };
}

test("public SellerProfile inspector accepts the exact reviewed predecessor", async () => {
  const directory = mkdtempSync(join(tmpdir(), "seller-profile-enable-ready-"));
  try {
    const env = environment(directory, "ready-or-enabled");
    const evidence = await inspectSellerProfileEnableProduction(
      env,
      { Client: fakeClientClass() },
    );
    assert.equal(evidence.state, "ready");
    assert.equal(evidence.posture.runtime_crud_grant_count, 4);
    assert.equal(evidence.posture.private_force, true);
    assert.equal(evidence.containsRowData, false);
    assert.equal(evidence.productionChanged, false);
    assert.deepEqual(JSON.parse(readFileSync(env.SELLER_PROFILE_ENABLE_EVIDENCE_PATH, "utf8")), evidence);
    assert.equal(statSync(env.SELLER_PROFILE_ENABLE_EVIDENCE_PATH).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("public SellerProfile inspector accepts policyless ENABLE with zero direct authority", async () => {
  const directory = mkdtempSync(join(tmpdir(), "seller-profile-enable-enabled-"));
  try {
    const env = environment(directory, "enabled");
    const evidence = await inspectSellerProfileEnableProduction(
      env,
      { Client: fakeClientClass({ enabled: true }) },
    );
    assert.equal(evidence.state, "enabled");
    assert.equal(evidence.posture.public_rls, true);
    assert.equal(evidence.posture.public_force, false);
    assert.equal(evidence.posture.nonowner_table_grant_count, 0);
    assert.equal(evidence.posture.nonowner_column_grant_count, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("public SellerProfile inspector rejects an unexpected activation state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "seller-profile-enable-state-"));
  try {
    await assert.rejects(
      inspectSellerProfileEnableProduction(
        environment(directory, "enabled"),
        { Client: fakeClientClass() },
      ),
      /expected enabled, found ready/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

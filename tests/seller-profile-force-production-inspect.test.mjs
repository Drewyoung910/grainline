import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SELLER_PROFILE_ENABLE,
  SELLER_PROFILE_FORCE,
  SELLER_PROFILE_PREPARATION,
  inspectSellerProfileForceProduction,
} from "../scripts/seller-profile-force-production-inspect.mjs";

const releaseCommit = "a".repeat(40);

function accepted({ name, checksum }) {
  return {
    migration_name: name,
    checksum,
    finished_at: "2026-10-22T12:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function fakeClientClass({ forced = false } = {}) {
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
          accepted(SELLER_PROFILE_PREPARATION),
          accepted(SELLER_PROFILE_ENABLE),
          ...(forced ? [accepted(SELLER_PROFILE_FORCE)] : []),
        ] };
      }
      if (sql.includes("AS public_rls")) {
        return { rows: [{
          public_rls: true,
          public_force: forced,
          public_policy_count: 0,
          private_rls: true,
          private_force: true,
          private_policy_count: 0,
          restricted_role_count: 2,
          runtime_crud_grant_count: 0,
          nonowner_table_grant_count: 0,
          nonowner_column_grant_count: 0,
          private_nonowner_table_grant_count: 0,
          private_nonowner_column_grant_count: 0,
          runtime_column_authority: false,
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
    SELLER_PROFILE_FORCE_EXPECTED_STATE: expectedState,
    SELLER_PROFILE_FORCE_EVIDENCE_PATH: join(directory, `${expectedState}.json`),
    SELLER_PROFILE_FORCE_RELEASE_COMMIT: releaseCommit,
  };
}

async function inspect(expectedState, forced = false) {
  const directory = mkdtempSync(join(tmpdir(), "seller-profile-force-"));
  const env = environment(directory, expectedState);
  try {
    const evidence = await inspectSellerProfileForceProduction(
      env,
      { Client: fakeClientClass({ forced }) },
    );
    assert.deepEqual(
      JSON.parse(readFileSync(env.SELLER_PROFILE_FORCE_EVIDENCE_PATH, "utf8")),
      evidence,
    );
    assert.equal(statSync(env.SELLER_PROFILE_FORCE_EVIDENCE_PATH).mode & 0o777, 0o600);
    return evidence;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("FORCE inspector accepts the exact policyless ENABLE predecessor", async () => {
  const evidence = await inspect("enabled-or-forced");
  assert.equal(evidence.state, "enabled");
  assert.equal(evidence.posture.public_rls, true);
  assert.equal(evidence.posture.public_force, false);
  assert.equal(evidence.posture.nonowner_table_grant_count, 0);
  assert.equal(evidence.containsRowData, false);
  assert.equal(evidence.productionChanged, false);
});

test("FORCE inspector accepts the final policyless forced posture", async () => {
  const evidence = await inspect("forced", true);
  assert.equal(evidence.state, "forced");
  assert.equal(evidence.posture.public_force, true);
  assert.equal(evidence.posture.private_force, true);
});

test("FORCE inspector rejects an unexpected state", async () => {
  await assert.rejects(inspect("forced"), /expected forced, found enabled/u);
});

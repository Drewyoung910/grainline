import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SELLER_PROFILE_PUBLIC_ENABLE,
  SELLER_PROFILE_PUBLIC_PREPARATIONS,
  verifySellerProfilePublicPreparationSources,
} from "../scripts/seller-profile-public-preparation-manifest.mjs";
import { inspectSellerProfilePublicPreparationProduction } from
  "../scripts/seller-profile-public-preparation-production-inspect.mjs";

const releaseCommit = "a".repeat(40);

function accepted({ name, checksum }) {
  return {
    migration_name: name,
    checksum,
    finished_at: "2026-10-19T12:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

const posture = Object.freeze({
  public_rls: false,
  public_force: false,
  public_policy_count: 0,
  private_rls: true,
  private_force: true,
  private_policy_count: 0,
  restricted_role_count: 2,
  runtime_crud_grant_count: 4,
  nonowner_table_grant_count: 4,
  nonowner_column_grant_count: 0,
  private_nonowner_table_grant_count: 0,
  private_nonowner_column_grant_count: 0,
});

function fakeClientClass({ appliedCount = 0, extraRows = [] } = {}) {
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
        return {
          rows: [
            ...SELLER_PROFILE_PUBLIC_PREPARATIONS.slice(0, appliedCount).map(accepted),
            ...extraRows,
          ],
        };
      }
      if (sql.includes("AS public_rls")) return { rows: [{ ...posture }] };
      throw new Error(`unexpected inspector query: ${sql.slice(0, 120)}`);
    }
  };
}

function environment(directory, expectedState = "restart-safe") {
  return {
    DIRECT_URL: "postgresql://example.invalid/grainline",
    SELLER_PROFILE_PREPARATION_EXPECTED_STATE: expectedState,
    SELLER_PROFILE_PREPARATION_EVIDENCE_PATH: join(directory, `${expectedState}.json`),
    SELLER_PROFILE_PREPARATION_RELEASE_COMMIT: releaseCommit,
  };
}

async function inspect({ appliedCount = 0, extraRows = [], expectedState } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "seller-profile-public-preparation-"));
  const env = environment(directory, expectedState);
  try {
    const evidence = await inspectSellerProfilePublicPreparationProduction(
      env,
      { Client: fakeClientClass({ appliedCount, extraRows }) },
    );
    assert.deepEqual(
      JSON.parse(readFileSync(env.SELLER_PROFILE_PREPARATION_EVIDENCE_PATH, "utf8")),
      evidence,
    );
    assert.equal(statSync(env.SELLER_PROFILE_PREPARATION_EVIDENCE_PATH).mode & 0o777, 0o600);
    return evidence;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("preparation manifest seals all 50 migrations plus ENABLE", () => {
  assert.deepEqual(verifySellerProfilePublicPreparationSources(), {
    preparations: 50,
    first: "20261019010000_prepare_seller_profile_public_map_authority",
    last: "20261020235700_correct_seller_profile_projection_timestamps",
    enable: SELLER_PROFILE_PUBLIC_ENABLE.name,
  });
});

test("preparation inspector accepts a fresh predecessor and returns the exact suffix", async () => {
  const evidence = await inspect();
  assert.equal(evidence.state, "ready");
  assert.equal(evidence.appliedCount, 0);
  assert.equal(evidence.pendingCount, 50);
  assert.deepEqual(evidence.pending, SELLER_PROFILE_PUBLIC_PREPARATIONS.map(({ name }) => name));
  assert.equal(evidence.containsRowData, false);
  assert.equal(evidence.productionChanged, false);
});

test("preparation inspector resumes an exact applied prefix", async () => {
  const evidence = await inspect({ appliedCount: 19 });
  assert.equal(evidence.state, "partial");
  assert.equal(evidence.appliedCount, 19);
  assert.deepEqual(
    evidence.pending,
    SELLER_PROFILE_PUBLIC_PREPARATIONS.slice(19).map(({ name }) => name),
  );
});

test("preparation inspector accepts the fully prepared predecessor posture", async () => {
  const evidence = await inspect({ appliedCount: 50, expectedState: "prepared" });
  assert.equal(evidence.state, "prepared");
  assert.deepEqual(evidence.pending, []);
  assert.deepEqual(evidence.posture, posture);
});

test("preparation inspector rejects a non-prefix or unresolved attempt", async () => {
  await assert.rejects(
    inspect({
      appliedCount: 1,
      extraRows: [accepted(SELLER_PROFILE_PUBLIC_PREPARATIONS[2])],
    }),
    /not an applied prefix/u,
  );
  await assert.rejects(
    inspect({
      extraRows: [{
        migration_name: SELLER_PROFILE_PUBLIC_PREPARATIONS[0].name,
        checksum: SELLER_PROFILE_PUBLIC_PREPARATIONS[0].checksum,
        finished_at: null,
        rolled_back_at: null,
        applied_steps_count: 0,
      }],
    }),
    /unresolved failed attempt/u,
  );
});

test("preparation inspector refuses to run after SellerProfile ENABLE", async () => {
  await assert.rejects(
    inspect({
      appliedCount: 48,
      extraRows: [accepted(SELLER_PROFILE_PUBLIC_ENABLE)],
    }),
    /ENABLE is already applied/u,
  );
});

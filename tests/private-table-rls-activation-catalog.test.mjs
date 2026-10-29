import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PRIVATE_TABLE_RLS_ACTIVATION_CONFIRMATION,
  privateTableRlsActivation,
  verifyPrivateTableRlsActivationSource,
} from "../scripts/private-table-rls-activation-catalog.mjs";

const releaseId = "maker_verification_v1";
const release = privateTableRlsActivation(releaseId);
const verified = verifyPrivateTableRlsActivationSource(releaseId);

test("catalog byte-seals the combined policyless activation and rollback", () => {
  assert.equal(
    PRIVATE_TABLE_RLS_ACTIVATION_CONFIRMATION,
    "activate-reviewed-private-table-rls",
  );
  assert.equal(release.table, "MakerVerification");
  assert.equal(
    release.minimumCompatibleAppCommit,
    "f2a23fd301ce5ba8c3968eccd6a2e9cb7b798799",
  );
  assert.equal(release.preparation.table, release.table);
  assert.equal(release.mode, "policyless_combined_enable_force");
  assert.equal(release.expectedPolicyCount, 0);
  assert.deepEqual(release.predecessorRuntimePrivileges, [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
  ]);
  assert.deepEqual(release.activatedRuntimePrivileges, []);
  assert.deepEqual(release.activatedStaffPrivileges, []);
  assert.deepEqual(release.activatedPublicPrivileges, []);
  assert.equal(verified.migrationDigest, release.migrationSha256);
  assert.equal(verified.rollbackDigest, release.rollbackSha256);
  assert.throws(
    () => verifyPrivateTableRlsActivationSource("unreviewed_release"),
    /release id is not reviewed/u,
  );
});

test("catalog binds all prepared operations into the activation preflight", () => {
  const activation = readFileSync(verified.migrationPath, "utf8");
  assert.equal(release.preparation.functions.length, 13);
  for (const entry of release.preparation.functions) {
    const argumentsLiteral = entry.arguments.replace(/,\s+/gu, ",");
    assert.match(
      activation,
      new RegExp(
        `'public\\.${entry.name}\\(${argumentsLiteral.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\)'::pg_catalog\\.regprocedure`,
        "u",
      ),
    );
  }
  assert.match(activation, /current_user <> session_user/u);
  assert.match(activation, /role_state\.rolinherit/u);
  assert.match(activation, /owner_role\.rolsuper OR owner_role\.rolbypassrls/u);
});

test("activation and rollback retain one-table, no-policy boundaries", () => {
  const activation = readFileSync(verified.migrationPath, "utf8");
  const rollback = readFileSync(verified.rollbackPath, "utf8");
  assert.deepEqual(
    [...activation.matchAll(/\b(?:ALTER|LOCK)\s+TABLE\s+public\."([^"]+)"/gu)]
      .map((match) => match[1]),
    ["MakerVerification", "MakerVerification", "MakerVerification"],
  );
  assert.deepEqual(
    [...rollback.matchAll(/\b(?:ALTER|LOCK)\s+TABLE\s+public\."([^"]+)"/gu)]
      .map((match) => match[1]),
    ["MakerVerification", "MakerVerification", "MakerVerification"],
  );
  assert.doesNotMatch(activation, /CREATE\s+POLICY/iu);
  assert.doesNotMatch(rollback, /CREATE\s+POLICY/iu);
  assert.doesNotMatch(activation, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

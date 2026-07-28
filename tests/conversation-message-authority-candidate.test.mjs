import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS,
  CONVERSATION_MESSAGE_PRIVATE_FUNCTION_NAMES,
  CONVERSATION_MESSAGE_RECIPIENT_FUNCTIONS,
  CONVERSATION_MESSAGE_SERVICE_FUNCTIONS,
} from "../scripts/conversation-message-authority-catalog.mjs";

const migrationPath =
  "prisma/migrations/20260726022500_prepare_conversation_message_authority/migration.sql";
const disposableMigrationSha256 =
  "9b56eb4c0e25e5de5266998f29a19fb0c7173c49f2b83266f3223542c7feeb07";
const recipientSql = readFileSync(
  "docs/rls-drafts/conversation-message-recipient-access.sql",
  "utf8",
);
const serviceSql = readFileSync(
  "docs/rls-drafts/conversation-message-service-authority.sql",
  "utf8",
);
const stageScript = readFileSync(
  "scripts/stage-conversation-message-authority-migration.mjs",
  "utf8",
);
const proof = readFileSync(
  "scripts/conversation-message-authority-preparation-proof.mjs",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const provision = readFileSync(
  "scripts/provision-runtime-db-role.sql",
  "utf8",
);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function functionBlock(source, functionName) {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} definition is missing`);
  const next = source.indexOf(
    "\nCREATE OR REPLACE FUNCTION public.",
    start + marker.length,
  );
  const revoke = source.indexOf("\nREVOKE ALL ON FUNCTION", start);
  const endCandidates = [next, revoke].filter((index) => index >= 0);
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : source.length;
  return source.slice(start, end);
}

describe("Conversation and Message functions-only authority candidate", () => {
  it("pins one unique 25-function catalog with six owner-private cores", () => {
    assert.equal(CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.length, 25);
    assert.equal(CONVERSATION_MESSAGE_RECIPIENT_FUNCTIONS.length, 9);
    assert.equal(CONVERSATION_MESSAGE_SERVICE_FUNCTIONS.length, 16);
    assert.equal(CONVERSATION_MESSAGE_PRIVATE_FUNCTION_NAMES.length, 6);
    assert.equal(
      new Set(
        CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.map((entry) => entry.name),
      ).size,
      25,
    );
    assert.equal(
      new Set(
        CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.map(
          (entry) => `${entry.name}(${entry.signature})`,
        ),
      ).size,
      25,
    );
  });

  it("matches every catalog entry to a pinned draft mode and exact runtime ACL", () => {
    for (const entry of CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS) {
      const source = recipientSql.includes(
        `CREATE OR REPLACE FUNCTION public.${entry.name}(`,
      )
        ? recipientSql
        : serviceSql;
      const block = functionBlock(source, entry.name);
      assert.match(
        block,
        entry.securityDefiner
          ? /\nSECURITY DEFINER\n/
          : /\nSECURITY INVOKER\n/,
      );
      assert.match(block, /\nSET search_path = pg_catalog\n/);
      assert.doesNotMatch(block, /\bEXECUTE\s+(?:FORMAT|IMMEDIATE)\b/i);
      assert.match(
        source,
        new RegExp(
          `REVOKE ALL ON FUNCTION[\\s\\S]*?public\\.${entry.name}\\([\\s\\S]*?FROM PUBLIC, grainline_app_runtime;`,
        ),
      );
      const grantPattern = new RegExp(
        `GRANT EXECUTE ON FUNCTION[\\s\\S]*?public\\.${entry.name}\\([\\s\\S]*?TO grainline_app_runtime;`,
      );
      if (entry.runtimeExecute) {
        assert.match(source, grantPattern);
      } else {
        assert.doesNotMatch(source, grantPattern);
      }
    }
  });

  it("builds only functions and ACLs from two exact byte-pinned sources", () => {
    const output = JSON.parse(execFileSync(
      process.execPath,
      ["scripts/stage-conversation-message-authority-migration.mjs", "--verify"],
      { encoding: "utf8" },
    ));
    assert.equal(output.mode, "--verify");
    assert.equal(output.staged, false);
    assert.equal(output.unstaged, false);
    assert.equal(output.migrationSha256, disposableMigrationSha256);
    assert.equal(output.functionCount, 25);
    assert.equal(output.rlsChanged, false);
    assert.equal(output.tableGrantsChanged, false);
    assert.equal(output.productionChanged, false);
    assert.equal(output.persistentStagingChanged, false);
    assert.match(stageScript, /byte pin drifted/);
    assert.match(stageScript, /contains table or policy activation SQL/);
    assert.match(stageScript, /functions-only boundary/);
    assert.match(stageScript, /may be staged only for loopback grainline_ci/);
    assert.match(stageScript, /refusing to remove drifted authority migration/);
    assert.match(stageScript, /destination contains unexpected entries/);
  });

  it("keeps the promoted migration executable-equivalent to the generated candidate", () => {
    if (!existsSync(migrationPath)) return;
    const migration = readFileSync(migrationPath, "utf8");
    assert.equal(
      sha256(migration),
      "eba8daf4228efd0d13c35a8a99b68167fa879b11791f3059efbaa7599c793b98",
    );
    const disposableEquivalent = `${migration
      .replace(
        "-- Promoted reviewed Conversation/Message functions-only authority migration.",
        "-- Generated disposable Conversation/Message functions-only authority candidate.",
      )
      .replace(
        "-- Apply only through the guarded main-only production migration workflow.",
        "-- Do not apply outside the loopback grainline_ci proof workflow.",
      )}\n`;
    assert.equal(sha256(disposableEquivalent), disposableMigrationSha256);
    assert.equal(
      (migration.match(/CREATE OR REPLACE FUNCTION public\./g) ?? []).length,
      25,
    );
    assert.equal((migration.match(/^BEGIN;$/gm) ?? []).length, 1);
    assert.equal((migration.match(/^COMMIT;$/gm) ?? []).length, 1);
    assert.doesNotMatch(migration, /CREATE POLICY/);
    assert.doesNotMatch(
      migration,
      /ALTER TABLE public\."(?:Conversation|Message)"/,
    );
    assert.doesNotMatch(
      migration,
      /(?:GRANT|REVOKE)[\s\S]{0,80}ON TABLE public\."(?:Conversation|Message)"/,
    );
    assert.match(migration, /must retain disabled RLS/);
    assert.match(migration, /must not install policies/);
    assert.match(migration, /narrowed old-application table CRUD/);
  });

  it("proves exact bytes, RLS-off compatibility, public calls, and private denial", () => {
    assert.equal(
      pkg.scripts["audit:rls-conversation-message-authority-candidate"],
      "node scripts/stage-conversation-message-authority-migration.mjs",
    );
    assert.equal(
      pkg.scripts["audit:rls-conversation-message-authority-preparation"],
      "node scripts/conversation-message-authority-preparation-proof.mjs",
    );
    assert.match(proof, /refuses a non-loopback database/);
    assert.match(proof, /requires grainline_ci/);
    assert.match(
      proof,
      /verifyConversationMessageAuthorityRelease/,
    );
    assert.match(proof, /DISPOSABLE_CONVERSATION_MESSAGE_AUTHORITY_SHA256/);
    assert.match(proof, /old application direct insert/);
    assert.match(proof, /old application direct update/);
    assert.match(proof, /grainline_conversation_get/);
    assert.match(proof, /grainline_message_send_ordinary/);
    assert.match(proof, /grainline_conversation_lock_pair_core/);
    assert.match(proof, /privateCoresRuntimeCallable: false/);
    assert.match(proof, /productionChanged: false/);
    assert.match(proof, /persistentStagingChanged: false/);
  });

  it("orders promoted FORCE verification before migration and FORCE proofs afterward", () => {
    const migrationTree = ci.indexOf(
      "- name: Verify DirectUpload legacy repair migration tree",
    );
    const releaseProof = ci.indexOf(
      "- name: Verify Conversation and Message authority proof equivalence",
    );
    const activationProof = ci.indexOf(
      "- name: Verify Conversation and Message activation proof equivalence",
    );
    const forceProof = ci.indexOf(
      "- name: Verify Conversation and Message FORCE release artifact",
    );
    const apply = ci.indexOf(
      "- name: Apply migrations to CI Postgres",
    );
    const authorityAudit = ci.indexOf(
      "- name: Audit final runtime grants and RLS catalog",
    );
    const rollbackProof = ci.indexOf(
      "- name: Prove Conversation and Message FORCE rollback in ephemeral PostgreSQL",
    );
    const fullProof = ci.indexOf(
      "- name: Prove FORCE-hardened Conversation and Message authority in ephemeral PostgreSQL",
    );
    const staticTests = ci.indexOf("- name: Tests");
    assert.ok(migrationTree >= 0);
    assert.ok(releaseProof > migrationTree);
    assert.ok(activationProof > releaseProof);
    assert.ok(forceProof > activationProof);
    assert.ok(apply > forceProof);
    assert.ok(authorityAudit > apply);
    assert.ok(rollbackProof > authorityAudit);
    assert.ok(fullProof > rollbackProof);
    assert.ok(staticTests > fullProof);
  });

  it("keeps future role convergence aligned with 19 public and six private functions", () => {
    for (const entry of CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS) {
      assert.match(
        provision,
        new RegExp(`public\\."${entry.name}"\\(`),
      );
    }
    for (const privateName of CONVERSATION_MESSAGE_PRIVATE_FUNCTION_NAMES) {
      assert.doesNotMatch(
        provision,
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\."${privateName}"\\(`,
        ),
      );
    }
    const publicCatalog = provision.match(
      /WITH conversation_message_public_authority\(function_signature\) AS \(\s+VALUES([\s\S]*?)\n\)\nSELECT format/,
    );
    assert.ok(publicCatalog);
    assert.equal(
      (
        publicCatalog[1].match(
          /\('public\."grainline_[^"]+"\(/g,
        ) ?? []
      ).length,
      19,
    );
  });
});

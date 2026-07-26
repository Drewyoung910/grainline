import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CONVERSATION_MESSAGE_FORCE_RELEASE,
  verifyConversationMessageForceRelease,
} from "../scripts/verify-conversation-message-force-release.mjs";

function fixtureRoot() {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "conversation-message-force-release-"),
  );
  const migrations = path.join(root, "prisma", "migrations");
  mkdirSync(migrations, { recursive: true });
  return { root, migrations };
}

function writeRelease(migrations, release, contents) {
  const directory = path.join(migrations, release.migrationName);
  mkdirSync(directory);
  writeFileSync(path.join(directory, "migration.sql"), contents);
}

describe("Conversation and Message FORCE release artifact", () => {
  const activation = readFileSync(
    `prisma/migrations/${CONVERSATION_MESSAGE_FORCE_RELEASE.activation.migrationName}/migration.sql`,
    "utf8",
  );
  const force = readFileSync(
    `prisma/migrations/${CONVERSATION_MESSAGE_FORCE_RELEASE.force.migrationName}/migration.sql`,
    "utf8",
  );

  it("pins the activation baseline and exact FORCE-only hardening bytes", () => {
    assert.deepEqual(verifyConversationMessageForceRelease(), {
      status: "passed",
      activationMigration: "20260726073000_enable_conversation_message_rls",
      activationSha256:
        "d4ba421be0f66c5acbc331f9c70939846b0f9675ff5ae026c09735760d92811a",
      forceMigration: "20260726140000_force_conversation_message_rls",
      forceSha256:
        "ba7408ede5a63f9cc10531f2598cb0b1187441d7157dc600d5518cd327dcf42f",
      forceOnlyHardening: true,
      forcedTables: ["Conversation", "Message"],
    });
    assert.equal(
      (
        force.match(
          /^ALTER TABLE public\."(?:Conversation|Message)" FORCE ROW LEVEL SECURITY;$/gm,
        ) ?? []
      ).length,
      2,
    );
    assert.equal((force.match(/^BEGIN;$/gm) ?? []).length, 1);
    assert.equal((force.match(/^COMMIT;$/gm) ?? []).length, 1);
    assert.doesNotMatch(
      force,
      /^(?:CREATE|DROP)\s+POLICY\b|^(?:GRANT|REVOKE)\s|^(?:INSERT|UPDATE|DELETE)\s/mi,
    );
    assert.match(force, /current_user = 'neondb_owner'/);
    assert.match(
      force,
      /current_user = 'ci'[\s\S]{0,100}current_database\(\) = 'grainline_ci'/,
    );
    assert.match(force, /owner-session drain is incomplete/);
    assert.match(force, /membership-free/);
    assert.match(
      force,
      /grainline_conversation_participant_or_reported_select/,
    );
    assert.match(force, /grainline_message_participant_or_reported_select/);
    assert.match(force, /runtime table privileges must remain exact SELECT-only/);
  });

  it("fails closed on missing, drifting, or symlinked FORCE bytes", () => {
    {
      const { root, migrations } = fixtureRoot();
      writeRelease(
        migrations,
        CONVERSATION_MESSAGE_FORCE_RELEASE.activation,
        activation,
      );
      assert.throws(
        () => verifyConversationMessageForceRelease(root),
        /migration is missing/,
      );
    }
    {
      const { root, migrations } = fixtureRoot();
      writeRelease(
        migrations,
        CONVERSATION_MESSAGE_FORCE_RELEASE.activation,
        activation,
      );
      writeRelease(
        migrations,
        CONVERSATION_MESSAGE_FORCE_RELEASE.force,
        `${force}\n-- drift\n`,
      );
      assert.throws(
        () => verifyConversationMessageForceRelease(root),
        /migration bytes drifted/,
      );
    }
    {
      const { root, migrations } = fixtureRoot();
      writeRelease(
        migrations,
        CONVERSATION_MESSAGE_FORCE_RELEASE.activation,
        activation,
      );
      const directory = path.join(
        migrations,
        CONVERSATION_MESSAGE_FORCE_RELEASE.force.migrationName,
      );
      mkdirSync(directory);
      const target = path.join(root, "force.sql");
      writeFileSync(target, force);
      symlinkSync(target, path.join(directory, "migration.sql"));
      assert.throws(
        () => verifyConversationMessageForceRelease(root),
        /regular non-symlink/,
      );
    }
  });

  it("runs the exact FORCE proof in disposable PostgreSQL 16", () => {
    const workflow = readFileSync(
      ".github/workflows/conversation-message-force-proof.yml",
      "utf8",
    );
    assert.match(workflow, /image: postgres:16/);
    assert.match(
      workflow,
      /Apply current migrations including Conversation and Message FORCE/,
    );
    assert.match(
      workflow,
      /npm run audit:rls-conversation-message-force-release/,
    );
    assert.match(
      workflow,
      /npm run audit:rls-conversation-message-force-rollback/,
    );
    assert.match(
      workflow,
      /npm run audit:rls-conversation-message-recipient/,
    );
    assert.match(
      workflow,
      /GRANT_AUDIT_DATABASE_URL="\$DIRECT_URL" RUNTIME_DB_ROLE=grainline_app_runtime MIGRATION_DB_ROLE=ci npm run audit:db-grants -- --allow-loopback-ci/,
    );
    assert.doesNotMatch(workflow, /PRODUCTION_MIGRATION_DIRECT_URL/);
  });
});

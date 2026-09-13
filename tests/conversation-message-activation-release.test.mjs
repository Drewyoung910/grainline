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
  CONVERSATION_MESSAGE_ACTIVATION_RELEASE,
  DISPOSABLE_CONVERSATION_MESSAGE_ACTIVATION_SHA256,
  verifyConversationMessageActivationRelease,
} from "../scripts/verify-conversation-message-activation-release.mjs";

function fixtureRoot() {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "conversation-message-activation-release-"),
  );
  const migrations = path.join(root, "prisma", "migrations");
  mkdirSync(migrations, { recursive: true });
  return { root, migrations };
}

function releaseSource() {
  return readFileSync(
    `prisma/migrations/${CONVERSATION_MESSAGE_ACTIVATION_RELEASE.migrationName}/migration.sql`,
    "utf8",
  );
}

describe("Conversation and Message initial RLS activation release", () => {
  it("pins the promoted bytes and disposable-proof-equivalent body", () => {
    const source = releaseSource();
    const { root, migrations } = fixtureRoot();
    const directory = path.join(
      migrations,
      CONVERSATION_MESSAGE_ACTIVATION_RELEASE.migrationName,
    );
    mkdirSync(directory);
    writeFileSync(path.join(directory, "migration.sql"), source);

    assert.deepEqual(verifyConversationMessageActivationRelease(root), {
      status: "passed",
      migrationName: "20260726073000_enable_conversation_message_rls",
      migrationSha256:
        "d4ba421be0f66c5acbc331f9c70939846b0f9675ff5ae026c09735760d92811a",
      disposableProofSha256:
        "d8604106813da825d18352095be38755ba2baa0ce73d363ce3957bf4b53500c4",
      executableBodyMatchesDisposableProof: true,
      policyCount: 2,
      rlsEnabled: true,
      rlsForced: false,
      runtimeTablePrivileges: ["SELECT"],
    });
    assert.equal(
      DISPOSABLE_CONVERSATION_MESSAGE_ACTIVATION_SHA256,
      "d8604106813da825d18352095be38755ba2baa0ce73d363ce3957bf4b53500c4",
    );
  });

  it("fails closed on byte drift or a symlinked migration", () => {
    const source = releaseSource();

    {
      const { root, migrations } = fixtureRoot();
      const directory = path.join(
        migrations,
        CONVERSATION_MESSAGE_ACTIVATION_RELEASE.migrationName,
      );
      mkdirSync(directory);
      writeFileSync(
        path.join(directory, "migration.sql"),
        `${source}\n-- drift\n`,
      );
      assert.throws(
        () => verifyConversationMessageActivationRelease(root),
        /bytes drifted/,
      );
    }

    {
      const { root, migrations } = fixtureRoot();
      const directory = path.join(
        migrations,
        CONVERSATION_MESSAGE_ACTIVATION_RELEASE.migrationName,
      );
      mkdirSync(directory);
      const target = path.join(root, "target.sql");
      writeFileSync(target, source);
      symlinkSync(target, path.join(directory, "migration.sql"));
      assert.throws(
        () => verifyConversationMessageActivationRelease(root),
        /regular non-symlink/,
      );
    }
  });
});

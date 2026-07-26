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
  CONVERSATION_MESSAGE_AUTHORITY_RELEASE,
  DISPOSABLE_CONVERSATION_MESSAGE_AUTHORITY_SHA256,
  verifyConversationMessageAuthorityRelease,
} from "../scripts/verify-conversation-message-authority-release.mjs";

function fixtureRoot() {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "conversation-message-authority-release-"),
  );
  const migrations = path.join(root, "prisma", "migrations");
  mkdirSync(migrations, { recursive: true });
  return { root, migrations };
}

function releaseSource() {
  return readFileSync(
    `prisma/migrations/${CONVERSATION_MESSAGE_AUTHORITY_RELEASE.migrationName}/migration.sql`,
    "utf8",
  );
}

describe("Conversation and Message functions-only authority release", () => {
  it("pins the promoted bytes and disposable-proof-equivalent body", () => {
    const source = releaseSource();
    const { root, migrations } = fixtureRoot();
    const directory = path.join(
      migrations,
      CONVERSATION_MESSAGE_AUTHORITY_RELEASE.migrationName,
    );
    mkdirSync(directory);
    writeFileSync(path.join(directory, "migration.sql"), source);

    assert.deepEqual(verifyConversationMessageAuthorityRelease(root), {
      status: "passed",
      migrationName:
        "20260726022500_prepare_conversation_message_authority",
      migrationSha256:
        "eba8daf4228efd0d13c35a8a99b68167fa879b11791f3059efbaa7599c793b98",
      disposableProofSha256:
        "9b56eb4c0e25e5de5266998f29a19fb0c7173c49f2b83266f3223542c7feeb07",
      executableBodyMatchesDisposableProof: true,
      rlsChanged: false,
      tableGrantsChanged: false,
    });
    assert.equal(
      DISPOSABLE_CONVERSATION_MESSAGE_AUTHORITY_SHA256,
      "9b56eb4c0e25e5de5266998f29a19fb0c7173c49f2b83266f3223542c7feeb07",
    );
  });

  it("fails closed on byte drift or a symlinked migration", () => {
    const source = releaseSource();

    {
      const { root, migrations } = fixtureRoot();
      const directory = path.join(
        migrations,
        CONVERSATION_MESSAGE_AUTHORITY_RELEASE.migrationName,
      );
      mkdirSync(directory);
      writeFileSync(
        path.join(directory, "migration.sql"),
        `${source}\n-- drift\n`,
      );
      assert.throws(
        () => verifyConversationMessageAuthorityRelease(root),
        /bytes drifted/,
      );
    }

    {
      const { root, migrations } = fixtureRoot();
      const directory = path.join(
        migrations,
        CONVERSATION_MESSAGE_AUTHORITY_RELEASE.migrationName,
      );
      mkdirSync(directory);
      const target = path.join(root, "target.sql");
      writeFileSync(target, source);
      symlinkSync(target, path.join(directory, "migration.sql"));
      assert.throws(
        () => verifyConversationMessageAuthorityRelease(root),
        /regular non-symlink/,
      );
    }
  });
});

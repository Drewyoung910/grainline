#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CONVERSATION_MESSAGE_FORCE_RELEASE = Object.freeze({
  activation: Object.freeze({
    migrationName: "20260726073000_enable_conversation_message_rls",
    sha256: "d4ba421be0f66c5acbc331f9c70939846b0f9675ff5ae026c09735760d92811a",
  }),
  force: Object.freeze({
    migrationName: "20260726140000_force_conversation_message_rls",
    sha256: "ba7408ede5a63f9cc10531f2598cb0b1187441d7157dc600d5518cd327dcf42f",
  }),
});

function readPinnedRegularFile(root, release) {
  const migrationPath =
    `${root}/prisma/migrations/${release.migrationName}/migration.sql`;
  if (!existsSync(migrationPath)) {
    throw new Error(
      `reviewed Conversation/Message migration is missing: ${release.migrationName}`,
    );
  }
  const stat = lstatSync(migrationPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      `reviewed Conversation/Message migration must be a regular non-symlink file: ${release.migrationName}`,
    );
  }
  const contents = readFileSync(migrationPath, "utf8");
  const sha256 = createHash("sha256").update(contents).digest("hex");
  if (sha256 !== release.sha256) {
    throw new Error(
      `reviewed Conversation/Message migration bytes drifted: ${release.migrationName}`,
    );
  }
  return { contents, sha256 };
}

export function verifyConversationMessageForceRelease(root = process.cwd()) {
  const activation = readPinnedRegularFile(
    root,
    CONVERSATION_MESSAGE_FORCE_RELEASE.activation,
  );
  const force = readPinnedRegularFile(
    root,
    CONVERSATION_MESSAGE_FORCE_RELEASE.force,
  );
  if (
    !force.contents.startsWith(
      "-- Reviewed Conversation/Message FORCE hardening migration.\n",
    )
    || !force.contents.includes(
      "-- Apply only through the guarded main-only production migration workflow.\n",
    )
    || (
      force.contents.match(
        /^ALTER TABLE public\."(?:Conversation|Message)" FORCE ROW LEVEL SECURITY;$/gm,
      ) ?? []
    ).length !== 2
    || /ALTER TABLE public\."(?:Conversation|Message)" NO FORCE ROW LEVEL SECURITY;/.test(
      force.contents,
    )
    || /^(?:CREATE|DROP)\s+POLICY\b|^(?:GRANT|REVOKE)\s|^(?:INSERT|UPDATE|DELETE)\s/mi.test(
      force.contents,
    )
  ) {
    throw new Error(
      "reviewed Conversation/Message FORCE release shape drifted",
    );
  }
  return Object.freeze({
    status: "passed",
    activationMigration:
      CONVERSATION_MESSAGE_FORCE_RELEASE.activation.migrationName,
    activationSha256: activation.sha256,
    forceMigration: CONVERSATION_MESSAGE_FORCE_RELEASE.force.migrationName,
    forceSha256: force.sha256,
    forceOnlyHardening: true,
    forcedTables: Object.freeze(["Conversation", "Message"]),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyConversationMessageForceRelease())}\n`,
    );
  } catch {
    process.stderr.write(
      "Conversation/Message FORCE release verification failed closed.\n",
    );
    process.exitCode = 1;
  }
}

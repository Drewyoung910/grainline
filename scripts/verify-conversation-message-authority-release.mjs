#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  buildConversationMessageAuthorityCandidate,
} from "./stage-conversation-message-authority-migration.mjs";

export const CONVERSATION_MESSAGE_AUTHORITY_RELEASE = Object.freeze({
  migrationName: "20260726022500_prepare_conversation_message_authority",
  sha256: "eba8daf4228efd0d13c35a8a99b68167fa879b11791f3059efbaa7599c793b98",
});
export const DISPOSABLE_CONVERSATION_MESSAGE_AUTHORITY_SHA256 =
  "9b56eb4c0e25e5de5266998f29a19fb0c7173c49f2b83266f3223542c7feeb07";

const promotedHeader =
  "-- Promoted reviewed Conversation/Message functions-only authority migration.";
const disposableHeader =
  "-- Generated disposable Conversation/Message functions-only authority candidate.";
const promotedWorkflowHeader =
  "-- Apply only through the guarded main-only production migration workflow.";
const disposableWorkflowHeader =
  "-- Do not apply outside the loopback grainline_ci proof workflow.";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyConversationMessageAuthorityRelease(
  root = process.cwd(),
) {
  const migrationPath =
    `${root}/prisma/migrations/${CONVERSATION_MESSAGE_AUTHORITY_RELEASE.migrationName}/migration.sql`;
  if (!existsSync(migrationPath)) {
    throw new Error(
      "reviewed Conversation/Message authority migration is missing",
    );
  }
  const stat = lstatSync(migrationPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      "reviewed Conversation/Message authority migration must be a regular non-symlink file",
    );
  }

  const contents = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(contents);
  if (migrationSha256 !== CONVERSATION_MESSAGE_AUTHORITY_RELEASE.sha256) {
    throw new Error(
      "reviewed Conversation/Message authority migration bytes drifted",
    );
  }
  if (
    !contents.startsWith(`${promotedHeader}\n\n${promotedWorkflowHeader}\n\n`)
  ) {
    throw new Error(
      "reviewed Conversation/Message authority promotion header drifted",
    );
  }
  if (
    /CREATE\s+POLICY\b/i.test(contents)
    || /ALTER\s+TABLE\s+public\."(?:Conversation|Message)"/i.test(contents)
    || /(?:GRANT|REVOKE)[\s\S]{0,120}\bON\s+TABLE\s+public\."(?:Conversation|Message)"/i
      .test(contents)
  ) {
    throw new Error(
      "reviewed Conversation/Message authority migration crossed its functions-only boundary",
    );
  }

  // apply_patch normalizes the promoted artifact to one terminal newline. Add
  // the non-executable terminal newline back before comparing it with the
  // exact disposable candidate that passed PostgreSQL proof.
  const disposableProofEquivalent = `${contents
    .replace(promotedHeader, disposableHeader)
    .replace(promotedWorkflowHeader, disposableWorkflowHeader)}\n`;
  const disposableSha256 = sha256(disposableProofEquivalent);
  if (
    disposableSha256 !== DISPOSABLE_CONVERSATION_MESSAGE_AUTHORITY_SHA256
  ) {
    throw new Error(
      "Conversation/Message authority executable body drifted from disposable proof",
    );
  }
  const generated = buildConversationMessageAuthorityCandidate().migration;
  if (generated !== disposableProofEquivalent) {
    throw new Error(
      "Conversation/Message authority release no longer matches the byte-pinned generator",
    );
  }

  return Object.freeze({
    status: "passed",
    migrationName: CONVERSATION_MESSAGE_AUTHORITY_RELEASE.migrationName,
    migrationSha256,
    disposableProofSha256: disposableSha256,
    executableBodyMatchesDisposableProof: true,
    rlsChanged: false,
    tableGrantsChanged: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyConversationMessageAuthorityRelease())}\n`,
    );
  } catch {
    process.stderr.write(
      "Conversation/Message authority release verification failed closed.\n",
    );
    process.exitCode = 1;
  }
}

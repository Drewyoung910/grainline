#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  buildConversationMessageActivationCandidate,
  CONVERSATION_MESSAGE_ACTIVATION_MIGRATION,
} from "./stage-conversation-message-activation-migration.mjs";

export const CONVERSATION_MESSAGE_ACTIVATION_RELEASE = Object.freeze({
  migrationName: CONVERSATION_MESSAGE_ACTIVATION_MIGRATION,
  sha256: "d4ba421be0f66c5acbc331f9c70939846b0f9675ff5ae026c09735760d92811a",
});
export const DISPOSABLE_CONVERSATION_MESSAGE_ACTIVATION_SHA256 =
  "d8604106813da825d18352095be38755ba2baa0ce73d363ce3957bf4b53500c4";

const promotedHeader =
  "-- Promoted reviewed Conversation/Message initial RLS activation migration.";
const disposableHeader =
  "-- Generated disposable Conversation/Message initial RLS activation candidate.";
const promotedWorkflowHeader =
  "-- Apply only through the guarded main-only production migration workflow.";
const disposableWorkflowHeader =
  "-- Do not apply outside the loopback grainline_ci proof workflow.";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyConversationMessageActivationRelease(
  root = process.cwd(),
) {
  const migrationPath =
    `${root}/prisma/migrations/${CONVERSATION_MESSAGE_ACTIVATION_RELEASE.migrationName}/migration.sql`;
  if (!existsSync(migrationPath)) {
    throw new Error("reviewed Conversation/Message activation migration is missing");
  }
  const stat = lstatSync(migrationPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      "reviewed Conversation/Message activation migration must be a regular non-symlink file",
    );
  }

  const contents = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(contents);
  if (migrationSha256 !== CONVERSATION_MESSAGE_ACTIVATION_RELEASE.sha256) {
    throw new Error(
      "reviewed Conversation/Message activation migration bytes drifted",
    );
  }
  if (
    !contents.startsWith(`${promotedHeader}\n\n${promotedWorkflowHeader}\n\n`)
  ) {
    throw new Error(
      "reviewed Conversation/Message activation promotion header drifted",
    );
  }

  // apply_patch normalizes the promoted artifact to one terminal newline.
  // Restore the generator's second non-executable terminal newline before the
  // byte-equivalence comparison.
  const disposableProofEquivalent = `${contents
    .replace(promotedHeader, disposableHeader)
    .replace(promotedWorkflowHeader, disposableWorkflowHeader)}\n`;
  const disposableSha256 = sha256(disposableProofEquivalent);
  if (
    disposableSha256 !== DISPOSABLE_CONVERSATION_MESSAGE_ACTIVATION_SHA256
  ) {
    throw new Error(
      "Conversation/Message activation body drifted from disposable proof",
    );
  }
  const generated = buildConversationMessageActivationCandidate().migration;
  if (generated !== disposableProofEquivalent) {
    throw new Error(
      "Conversation/Message activation release no longer matches the byte-pinned generator",
    );
  }

  if (
    (contents.match(/CREATE\s+POLICY\b/gi) ?? []).length !== 2
    || (contents.match(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi) ?? []).length !== 2
    || (contents.match(/NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/gi) ?? []).length !== 2
    || /FOR\s+(?:INSERT|UPDATE|DELETE|ALL)\b/i.test(contents)
    || /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\b/i.test(contents)
  ) {
    throw new Error(
      "reviewed Conversation/Message activation crossed its SELECT-only boundary",
    );
  }

  return Object.freeze({
    status: "passed",
    migrationName: CONVERSATION_MESSAGE_ACTIVATION_RELEASE.migrationName,
    migrationSha256,
    disposableProofSha256: disposableSha256,
    executableBodyMatchesDisposableProof: true,
    policyCount: 2,
    rlsEnabled: true,
    rlsForced: false,
    runtimeTablePrivileges: Object.freeze(["SELECT"]),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyConversationMessageActivationRelease())}\n`,
    );
  } catch {
    process.stderr.write(
      "Conversation/Message activation release verification failed closed.\n",
    );
    process.exitCode = 1;
  }
}

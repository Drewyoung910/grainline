import "server-only";

export const CASE_EVIDENCE_ATTACHMENTS_ENABLED_ENV =
  "CASE_EVIDENCE_ATTACHMENTS_ENABLED";

export function caseEvidenceAttachmentsEnabled(
  env: NodeJS.ProcessEnv = process.env,
) {
  return env[CASE_EVIDENCE_ATTACHMENTS_ENABLED_ENV] === "true";
}

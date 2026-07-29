import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const migrationPath =
  "prisma/migrations/20260729061000_prepare_case_account_deletion_authority/migration.sql";
const migration = fs.readFileSync(migrationPath, "utf8");
const normalized = migration.replace(/\s+/g, " ");

describe("Case account-deletion authority migration", () => {
  it("is compatible preparation only", () => {
    assert.doesNotMatch(
      migration,
      /ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
    );
    assert.doesNotMatch(
      migration,
      /(?:GRANT|REVOKE).* ON TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)"/,
    );
    assert.doesNotMatch(
      migration,
      /CREATE POLICY .* ON public\."(?:Case|CaseMessage|CaseMessageAttachment)"/i,
    );
  });

  it("pins both narrow functions and exact execution grants", () => {
    assert.match(
      normalized,
      /CREATE FUNCTION public\.grainline_case_account_deletion_blockers\( p_actor_user_id text \) RETURNS bigint LANGUAGE plpgsql STABLE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog/,
    );
    assert.match(
      normalized,
      /CREATE FUNCTION public\.grainline_case_account_deletion_redact\( p_account_deletion_side_effect_id text \).* LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog/,
    );
    for (const signature of [
      "grainline_case_account_deletion_blockers\\(text\\)",
      "grainline_case_account_deletion_redact\\(text\\)",
    ]) {
      assert.match(
        normalized,
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${signature} FROM PUBLIC, grainline_app_runtime; GRANT EXECUTE ON FUNCTION public\\.${signature} TO grainline_app_runtime`,
        ),
      );
    }
  });

  it("derives and revalidates the deletion source after the User lock", () => {
    const discovery = normalized.indexOf(
      'FROM public."AccountDeletionSideEffect" AS effect WHERE effect.id = p_account_deletion_side_effect_id;',
    );
    const userLock = normalized.indexOf(
      'FROM public."User" AS account_user WHERE account_user.id = discovered_effect."userId" FOR UPDATE;',
    );
    const sourceLock = normalized.indexOf(
      'FROM public."AccountDeletionSideEffect" AS effect WHERE effect.id = p_account_deletion_side_effect_id FOR UPDATE;',
    );
    assert.ok(discovery >= 0);
    assert.ok(discovery < userLock);
    assert.ok(userLock < sourceLock);
    assert.match(
      normalized,
      /locked_effect\.kind IS DISTINCT FROM 'LOCAL_ANONYMIZE'/,
    );
    assert.match(
      normalized,
      /locked_effect\."dedupKey" IS DISTINCT FROM 'account-delete:local:' \|\| locked_user\.id/,
    );
    assert.match(
      normalized,
      /locked_effect\.payload IS DISTINCT FROM '\{\}'::jsonb/,
    );
    assert.match(
      normalized,
      /locked_effect\.status IS NULL OR locked_effect\.status NOT IN \('PENDING', 'PROCESSING', 'FAILED'\)/,
    );
  });

  it("rechecks active Cases after locking the deleting User", () => {
    assert.match(
      normalized,
      /case_row\.status IN \( 'OPEN'::public\."CaseStatus", 'IN_DISCUSSION'::public\."CaseStatus", 'PENDING_CLOSE'::public\."CaseStatus", 'UNDER_REVIEW'::public\."CaseStatus" \)/,
    );
    assert.match(
      normalized,
      /IF active_case_count > 0 THEN RAISE EXCEPTION 'Case account-deletion redaction is blocked by an active Case' USING ERRCODE = '55000'/,
    );
  });

  it("derives needles and fixed redaction targets inside PostgreSQL", () => {
    const redactionFunction = migration.slice(
      migration.indexOf(
        "CREATE FUNCTION public.grainline_case_account_deletion_redact",
      ),
      migration.indexOf(
        "REVOKE ALL ON FUNCTION\n  public.grainline_case_account_deletion_blockers",
      ),
    );
    assert.match(
      normalized,
      /public\.grainline_account_deletion_email_key_core\( other_user\.email \) = public\.grainline_account_deletion_email_key_core\( address\.email \)/,
    );
    assert.match(
      normalized,
      /public\.grainline_account_deletion_redact_text_core\( message\.body, sensitive_values \)/,
    );
    assert.match(
      normalized,
      /UPDATE public\."CaseMessage" AS message SET body = '\[Message deleted\]' WHERE message\."authorId" = locked_user\.id/,
    );
    assert.match(
      normalized,
      /UPDATE public\."Case" AS case_row SET description = '\[Case description deleted\]' WHERE case_row\."buyerId" = locked_user\.id/,
    );
    assert.match(
      normalized,
      /public\.grainline_account_deletion_redact_text_core\( case_row\.description, sensitive_values \)/,
    );
    assert.match(
      normalized,
      /WHERE case_row\."sellerId" = locked_user\.id AND case_row\."buyerId" IS DISTINCT FROM locked_user\.id AND case_row\.description IS NOT NULL/,
    );
    assert.doesNotMatch(
      redactionFunction,
      /p_(?:user|actor)_id|p_sensitive_values|p_case_id|p_message_id/,
    );
  });
});

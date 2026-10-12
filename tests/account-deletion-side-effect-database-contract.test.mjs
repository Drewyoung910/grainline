import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("src/lib/accountDeletionSideEffectDb.ts", "utf8");
const sideEffects = readFileSync("src/lib/accountDeletionSideEffects.ts", "utf8");
const accountDeletion = readFileSync("src/lib/accountDeletion.ts", "utf8");
const route = readFileSync("src/app/api/account/delete/route.ts", "utf8");
const opsHealth = readFileSync("src/app/api/cron/ops-health/route.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261011170000_prepare_account_deletion_side_effect_claim_fence/migration.sql",
  "utf8",
);
const activation = readFileSync(
  "prisma/migrations/20261011180000_enable_account_deletion_side_effect_rls/migration.sql",
  "utf8",
);
const mediaKeyFence = readFileSync(
  "prisma/migrations/20261011173000_prepare_account_deletion_media_key_fence/migration.sql",
  "utf8",
);
const userAccess = readFileSync("src/lib/userAccountDeletionAccess.ts", "utf8");
const caseAccess = readFileSync("src/lib/caseAccountDeletionAuthority.ts", "utf8");
const messageAccess = readFileSync("src/lib/conversationMessageAuthority.ts", "utf8");
const orderAccess = readFileSync("src/lib/orderAccountDeletionAuthority.ts", "utf8");

describe("account-deletion database credential boundary", () => {
  it("requires the exact dedicated role on the same pooled database", () => {
    assert.match(source, /ACCOUNT_DELETION_DATABASE_URL/);
    assert.match(source, /grainline_account_deletion_runtime/);
    assert.match(source, /must authenticate directly as/);
    assert.match(source, /must use a pooled endpoint/);
    assert.match(source, /same pooled database as DATABASE_URL/);
    assert.match(source, /DATABASE_URL must not authenticate as the account-deletion role/);
    assert.match(source, /max: 2/);
  });

  it("routes service-ledger operations through the dedicated client", () => {
    assert.match(sideEffects, /getAccountDeletionSideEffectClient/);
    assert.match(accountDeletion, /getAccountDeletionSideEffectClient/);
    assert.match(route, /getAccountDeletionSideEffectClient/);
    assert.match(opsHealth, /getAccountDeletionSideEffectClient/);
    assert.doesNotMatch(sideEffects, /enqueueAccountDeletionSideEffect\(prisma,/);
    assert.doesNotMatch(sideEffects, /prisma\.accountDeletionSideEffect\.find/);
  });

  it("binds every destructive account-deletion authority to the active claim", () => {
    assert.match(
      migration,
      /CREATE FUNCTION public\.grainline_account_deletion_claim_user\([\s\S]*effect\.status = 'PROCESSING'[\s\S]*effect\."claimGeneration" = p_claim_generation[\s\S]*effect\."claimToken" = p_claim_token/,
    );
    for (const legacyIdentity of [
      "grainline_user_account_deletion_preflight(text)",
      "grainline_user_account_deletion_snapshot(text)",
      "grainline_user_account_deletion_finalize(text)",
      "grainline_case_account_deletion_redact(text)",
      "grainline_message_redact_for_account_deletion(text)",
      "grainline_order_account_deletion_scrub(text, text[])",
    ]) {
      const escaped = legacyIdentity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(
        activation,
        new RegExp(`REVOKE ALL ON FUNCTION\\s+public\\.${escaped}\\s+FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime`, "s"),
      );
      assert.match(
        migration,
        new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${escaped}\\s+TO grainline_app_runtime`, "s"),
      );
    }
    for (const claimedIdentity of [
      "grainline_user_account_deletion_preflight(text, bigint, uuid)",
      "grainline_user_account_deletion_snapshot(text, bigint, uuid)",
      "grainline_user_account_deletion_finalize(text, bigint, uuid)",
      "grainline_case_account_deletion_redact(text, bigint, uuid)",
      "grainline_message_redact_for_account_deletion(text, text, bigint, uuid)",
      "grainline_order_account_deletion_scrub(text, text, bigint, uuid, text[])",
    ]) {
      const escaped = claimedIdentity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(
        migration,
        new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${escaped}\\s+TO grainline_app_runtime`, "s"),
      );
    }
    for (const authority of [userAccess, caseAccess, messageAccess, orderAccess]) {
      assert.match(authority, /claimGeneration/);
      assert.match(authority, /claimToken/);
      assert.match(authority, /::uuid/);
    }
    assert.match(accountDeletion, /claimGeneration: localClaimGeneration/);
    assert.match(accountDeletion, /claimToken: localClaimToken/);
    assert.match(
      mediaKeyFence,
      /CREATE FUNCTION public\.grainline_account_deletion_media_key_enqueue_claimed\([\s\S]*effect\.status = 'PROCESSING'[\s\S]*effect\."claimGeneration" = p_claim_generation[\s\S]*effect\."claimToken" = p_claim_token/,
    );
    assert.match(mediaKeyFence, /split_part\(supplied\.key, '\/', 2\)[\s\S]*source_actor_segment/);
    assert.match(
      activation,
      /REVOKE ALL ON FUNCTION\s+public\.grainline_account_deletion_media_enqueue_claimed\(text, bigint, uuid, text\[\]\)[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime/,
    );
    assert.match(
      activation,
      /GRANT EXECUTE ON FUNCTION\s+public\.grainline_account_deletion_media_key_enqueue_claimed\(text, bigint, uuid, text\[\]\)[\s\S]*TO grainline_app_runtime/,
    );
  });

  it("moves ledger trust from ordinary runtime to the dedicated role", () => {
    assert.match(
      migration,
      /GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]*?ON TABLE public\."AccountDeletionSideEffect"[\s\S]*?TO grainline_account_deletion_runtime/,
    );
    for (const identity of [
      "grainline_account_deletion_side_effect_claim(text)",
      "grainline_account_deletion_side_effect_complete(text, bigint, uuid)",
      "grainline_account_deletion_side_effect_fail(text, bigint, uuid, text)",
    ]) {
      const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(
        migration,
        new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${escaped}\\s+TO grainline_app_runtime, grainline_account_deletion_runtime`, "s"),
      );
    }
    assert.match(
      activation,
      /ALTER TABLE public\."AccountDeletionSideEffect" ENABLE ROW LEVEL SECURITY/,
    );
    assert.match(
      activation,
      /ALTER TABLE public\."AccountDeletionSideEffect" NO FORCE ROW LEVEL SECURITY/,
    );
    assert.match(
      activation,
      /CREATE POLICY "AccountDeletionSideEffect_account_deletion_runtime_all"[\s\S]*?TO grainline_account_deletion_runtime[\s\S]*?USING \(true\)[\s\S]*?WITH CHECK \(true\)/,
    );
    assert.match(
      activation,
      /REVOKE ALL ON TABLE public\."AccountDeletionSideEffect"[\s\S]*?FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime/,
    );
    assert.match(
      activation,
      /GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]*?TO grainline_account_deletion_runtime/,
    );
    for (const identity of [
      "grainline_account_deletion_side_effect_claim(text)",
      "grainline_account_deletion_side_effect_complete(text, bigint, uuid)",
      "grainline_account_deletion_side_effect_fail(text, bigint, uuid, text)",
    ]) {
      const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(
        activation,
        new RegExp(`REVOKE ALL ON FUNCTION\\s+public\\.${escaped}\\s+FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime`, "s"),
      );
      assert.match(
        activation,
        new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${escaped}\\s+TO grainline_account_deletion_runtime`, "s"),
      );
    }
  });
});

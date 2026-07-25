import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const recipientSql = fs.readFileSync(
  "docs/rls-drafts/conversation-message-recipient-access.sql",
  "utf8",
);
const policySql = fs.readFileSync(
  "docs/rls-drafts/conversation-message-policies.sql",
  "utf8",
);
const serviceSql = fs.readFileSync(
  "docs/rls-drafts/conversation-message-service-authority.sql",
  "utf8",
);
const contract = fs.readFileSync(
  "docs/conversation-message-authority-contract.md",
  "utf8",
);
const proof = fs.readFileSync(
  "scripts/conversation-message-recipient-rls-proof.mjs",
  "utf8",
);
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

const recipientFunctions = [
  "grainline_conversation_staff_report_visible",
  "grainline_conversation_get",
  "grainline_conversation_pair",
  "grainline_message_list",
  "grainline_message_unread_count",
  "grainline_message_latest_custom_request",
  "grainline_message_report_target_valid",
  "grainline_message_export",
  "grainline_conversation_inbox",
];
const publicWriteFunctions = [
  "grainline_conversation_start",
  "grainline_message_send_ordinary",
  "grainline_conversation_set_archived",
  "grainline_message_mark_read",
  "grainline_conversation_claim_message_email",
  "grainline_message_send_custom_request",
  "grainline_message_create_commission_interest",
  "grainline_message_send_custom_order_ready",
  "grainline_message_redact_for_account_deletion",
  "grainline_seller_message_response_metrics",
];

describe("Conversation and Message recipient RLS draft", () => {
  it("keeps the draft outside migrations and pins the recipient catalog", () => {
    const migrationSql = fs
      .readdirSync("prisma/migrations", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => fs.readFileSync(
        `prisma/migrations/${entry.name}/migration.sql`,
        "utf8",
      ))
      .join("\n");

    for (const functionName of recipientFunctions) {
      assert.match(recipientSql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\(`));
      assert.match(recipientSql, new RegExp(`GRANT EXECUTE ON FUNCTION[\\s\\S]*public\\.${functionName}\\(`));
      assert.doesNotMatch(migrationSql, new RegExp(`public\\.${functionName}\\(`));
      assert.match(contract, new RegExp(`\\b${functionName}\\b`));
    }
    assert.match(contract, /RLS disabled with zero[\s\S]*policies/);
    assert.match(contract, /not applied to any persistent database/);
  });

  it("limits definer reads to one boolean exact-report predicate", () => {
    assert.equal(
      (recipientSql.match(/\nSECURITY DEFINER\n/g) ?? []).length,
      1,
    );
    assert.match(
      recipientSql,
      /grainline_conversation_staff_report_visible[\s\S]*RETURNS boolean[\s\S]*SECURITY DEFINER/,
    );
    assert.match(recipientSql, /staff_user\.role IN \([\s\S]*'EMPLOYEE'[\s\S]*'ADMIN'/);
    assert.match(recipientSql, /staff_user\.banned = false/);
    assert.match(recipientSql, /staff_user\."deletedAt" IS NULL/);
    assert.match(recipientSql, /report\."targetType" = 'MESSAGE_THREAD'/);
    assert.match(recipientSql, /report\."targetId" = p_conversation_id/);
    assert.match(recipientSql, /report\.resolved = false/);
    assert.doesNotMatch(recipientSql, /\bEXECUTE\s+FORMAT\b/i);
    assert.doesNotMatch(recipientSql, /\bAS\s+(?:constraint|current_user|session_user|table|user)\b/i);
  });

  it("sets bounded transaction-local context in every invoker projection", () => {
    assert.equal(
      (recipientSql.match(/\nSECURITY INVOKER\n/g) ?? []).length,
      recipientFunctions.length - 1,
    );
    assert.equal(
      (recipientSql.match(/pg_catalog\.set_config\('app\.user_id', p_user_id, true\)/g) ?? []).length,
      recipientFunctions.length - 1,
    );
    assert.equal(
      (recipientSql.match(/\^\[A-Za-z0-9\._:-\]\{1,128\}\$/g) ?? []).length,
      recipientFunctions.length - 1,
    );
    assert.doesNotMatch(recipientSql, /set_config\('app\.user_id'[\s\S]*false\)/);
  });

  it("uses two SELECT-only policies and removes direct runtime writes", () => {
    assert.equal((policySql.match(/CREATE POLICY/g) ?? []).length, 2);
    assert.equal((policySql.match(/\n\s*FOR SELECT\n/g) ?? []).length, 2);
    assert.match(policySql, /grainline_conversation_participant_or_reported_select/);
    assert.match(policySql, /grainline_message_participant_or_reported_select/);
    assert.equal(
      (policySql.match(/grainline_conversation_staff_report_visible/g) ?? []).length,
      2,
    );
    assert.match(policySql, /REVOKE ALL ON TABLE public\."Conversation"/);
    assert.match(policySql, /REVOKE ALL ON TABLE public\."Message"/);
    assert.match(policySql, /GRANT SELECT ON TABLE public\."Conversation"/);
    assert.match(policySql, /GRANT SELECT ON TABLE public\."Message"/);
    assert.doesNotMatch(policySql, /GRANT (?:INSERT|UPDATE|DELETE)/);
    assert.doesNotMatch(policySql, /CREATE POLICY[\s\S]*FOR (?:INSERT|UPDATE|DELETE)/);
  });

  it("keeps reads bounded and preserves stable cursor tie-breakers", () => {
    assert.match(recipientSql, /LEAST\(COALESCE\(p_limit, 50\), 201\)/);
    assert.match(recipientSql, /LEAST\(COALESCE\(p_limit, 51\), 51\)/);
    assert.match(recipientSql, /message\."createdAt" < p_cursor_at[\s\S]*message\.id < p_cursor_id/);
    assert.match(recipientSql, /message\."createdAt" > p_cursor_at[\s\S]*message\.id > p_cursor_id/);
    assert.match(recipientSql, /conversation\."updatedAt" < p_before_at[\s\S]*conversation\.id < p_before_id/);
    assert.match(recipientSql, /ORDER BY conversation\."updatedAt" DESC, conversation\.id DESC/);
    assert.match(recipientSql, /ORDER BY message\."createdAt" DESC, message\.id DESC/);
    assert.match(recipientSql, /ORDER BY message\."createdAt" ASC, message\.id ASC/);
  });

  it("runs only against disposable loopback CI and records the proof mode honestly", () => {
    assert.equal(
      pkg.scripts["audit:rls-conversation-message-recipient"],
      "node scripts/conversation-message-recipient-rls-proof.mjs",
    );
    assert.match(ci, /Prove Conversation and Message recipient RLS draft in ephemeral PostgreSQL/);
    assert.match(ci, /CONVERSATION_MESSAGE_RECIPIENT_RLS_PROOF_DATABASE_URL/);
    assert.match(proof, /refuses a non-loopback database/);
    assert.match(proof, /requires grainline_ci/);
    assert.match(proof, /effectiveRuntimeRole: runtimeRole/);
    assert.match(proof, /proofMode: "ephemeral_owner_session_set_role"/);
    assert.match(proof, /productionChanged: false/);
    assert.match(proof, /persistentStagingChanged: false/);
    assert.match(proof, /directWithoutContext/);
    assert.match(proof, /contextCleared/);
    assert.match(proof, /resolvedStaff/);
    assert.match(proof, /bannedStaff/);
    assert.match(proof, /direct runtime Message insert/);
    assert.match(proof, /direct runtime Conversation update/);
    assert.match(proof, /direct runtime Message delete/);
    assert.match(proof, /proveBlockRaces\(owner\)/);
    assert.match(proof, /proveAccountDeletionRaces\(owner\)/);
    assert.match(proof, /proveMarkReadRaces\(owner\)/);
    assert.match(proof, /proveArchiveRaces\(owner\)/);
    assert.match(proof, /wait_event_type === "Lock"/);
  });

  it("keeps ordinary write targets derived and private cores ungranted", () => {
    for (const functionName of publicWriteFunctions) {
      assert.match(serviceSql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\(`));
      assert.match(serviceSql, new RegExp(`GRANT EXECUTE ON FUNCTION[\\s\\S]*public\\.${functionName}\\(`));
      assert.match(contract, new RegExp(`\\b${functionName}\\b`));
    }
    assert.match(serviceSql, /grainline_conversation_lock_pair_core/);
    assert.match(serviceSql, /grainline_conversation_listing_core/);
    assert.match(serviceSql, /grainline_conversation_get_or_create_core/);
    assert.match(serviceSql, /grainline_account_deletion_email_key_core/);
    assert.match(serviceSql, /grainline_account_deletion_regex_escape_core/);
    assert.match(serviceSql, /grainline_account_deletion_redact_text_core/);
    assert.match(
      serviceSql,
      /REVOKE ALL ON FUNCTION[\s\S]*grainline_conversation_lock_pair_core[\s\S]*FROM PUBLIC, grainline_app_runtime/,
    );
    assert.match(
      serviceSql,
      /REVOKE ALL ON FUNCTION[\s\S]*grainline_conversation_listing_core[\s\S]*FROM PUBLIC, grainline_app_runtime/,
    );
    assert.match(
      serviceSql,
      /REVOKE ALL ON FUNCTION[\s\S]*grainline_conversation_get_or_create_core[\s\S]*FROM PUBLIC, grainline_app_runtime/,
    );
    for (const privateDeletionCore of [
      "grainline_account_deletion_email_key_core",
      "grainline_account_deletion_regex_escape_core",
      "grainline_account_deletion_redact_text_core",
    ]) {
      assert.match(
        serviceSql,
        new RegExp(
          `REVOKE ALL ON FUNCTION[\\s\\S]*${privateDeletionCore}[\\s\\S]*FROM PUBLIC, grainline_app_runtime`,
        ),
      );
    }
    assert.doesNotMatch(
      serviceSql,
      /GRANT EXECUTE ON FUNCTION\s+public\.grainline_conversation_(?:lock_pair|listing|get_or_create)_core\s*\(/,
    );
    assert.doesNotMatch(
      serviceSql,
      /GRANT EXECUTE ON FUNCTION\s+public\.grainline_account_deletion_(?:email_key|regex_escape|redact_text)_core\s*\(/,
    );
    assert.match(serviceSql, /p_kind IS NOT NULL AND p_kind <> 'file'/);
    assert.match(serviceSql, /parsed_file->>'kind' <> 'file'/);
    assert.match(serviceSql, /"recipientId" := CASE/);
    assert.match(serviceSql, /"isSystemMessage",[\s\S]*false,/);
    assert.match(serviceSql, /FOR SHARE;[\s\S]*Block/);
    assert.match(
      serviceSql,
      /FOR UPDATE;[\s\S]*"sentAt" := pg_catalog\.timezone\('UTC', pg_catalog\.clock_timestamp\(\)\)/,
    );
    assert.match(serviceSql, /source_message\."createdAt" - interval '5 minutes'/);
    assert.match(
      serviceSql,
      /'custom_order_request',\s+false,\s+message_sent_at/,
    );
    assert.match(
      serviceSql,
      /'commission_interest_card',\s+true,\s+message_sent_at/,
    );
    assert.match(
      serviceSql,
      /message\."contextListingId" = source_listing\.id[\s\S]*message\.kind = 'custom_order_link'/,
    );
    assert.match(
      serviceSql,
      /'custom_order_link',\s+true,\s+message_sent_at/,
    );
    assert.match(
      serviceSql,
      /commission interest message evidence is invalid/,
    );
    assert.match(
      serviceSql,
      /custom-order-ready message evidence is invalid/,
    );
    assert.match(
      serviceSql,
      /pg_catalog\.jsonb_build_object\([\s\S]*'commissionId', p_commission_request_id/,
    );
    assert.match(
      serviceSql,
      /listing\."reservedForUserId" = initial_source\.buyer_user_id/,
    );
    assert.match(
      serviceSql,
      /UPDATE public\."Message" AS message[\s\S]*SET body = '\[Message deleted\]'[\s\S]*message\."senderId" = p_actor_id/,
    );
    assert.match(
      serviceSql,
      /message\."senderId" <> p_actor_id[\s\S]*message\."recipientId" = p_actor_id/,
    );
    assert.match(
      serviceSql,
      /\(\?<!\[\[:alnum:\]\]\)[\s\S]*\(\?!\[\[:alnum:\]\]\)/,
    );
    assert.match(
      serviceSql,
      /RETURNS TABLE \(\s*"buyerInitiatedCount" bigint,\s*"sellerRespondedCount" bigint\s*\)/,
    );
    assert.doesNotMatch(
      serviceSql,
      /(?<!pg_catalog\.timezone\('UTC', )pg_catalog\.clock_timestamp\(\)/,
    );
    assert.doesNotMatch(serviceSql, /\bEXECUTE\s+FORMAT\b/i);
    assert.doesNotMatch(serviceSql, /\bAS\s+(?:constraint|current_user|session_user|table|user)\b/i);
    assert.doesNotMatch(serviceSql, /pg_catalog\.(?:greatest|least|coalesce|nullif)/i);
  });
});

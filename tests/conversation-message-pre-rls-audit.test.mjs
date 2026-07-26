import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Conversation and Message pre-RLS audit guardrails", () => {
  it("keeps the new-conversation GET read-only and creation explicit", () => {
    const page = source("src/app/messages/new/page.tsx");
    assert.doesNotMatch(page, /conversation\.(?:create|update|updateMany|upsert)/);
    assert.match(page, /<ActionForm action=\{startConversation\}>/);
    assert.match(page, /startConversationForUser/);
    assert.match(page, /conversationStartRatelimit/);
    assert.match(page, /created only when you continue/);
  });

  it("serializes conversation creation with block and account lifecycle changes", () => {
    const access = source("src/lib/conversationStartAccess.ts");
    const authority = source("src/lib/conversationMessageAuthority.ts");
    const serviceSql = source("docs/rls-drafts/conversation-message-service-authority.sql");
    const startFunction = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_conversation_start"),
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_send_ordinary"),
    );
    assert.match(authority, /public\.grainline_conversation_start/);
    assert.match(access, /startActorConversation\(/);
    assert.match(startFunction, /transaction_isolation'\) <> 'read committed'/);
    assert.match(startFunction, /grainline_conversation_lock_pair_core/);
    assert.match(startFunction, /grainline_conversation_get_or_create_core/);
    assert.ok(
      serviceSql.indexOf("FOR SHARE") < serviceSql.indexOf('FROM public."Block" AS block'),
      "pair locks must precede the reciprocal block absence check in database authority",
    );
  });

  it("serializes ordinary sends with blocks and account deletion without a per-pair send mutex", () => {
    const page = source("src/app/messages/[id]/page.tsx");
    const access = source("src/lib/conversationStartAccess.ts");
    const deletion = source("src/lib/accountDeletion.ts");
    const sendTransaction = page.slice(page.indexOf("const txResult = await prisma.$transaction"));
    const pairLock = sendTransaction.indexOf("lockConversationParticipantPair(tx, me.id, recipientId)");
    const conversationLock = sendTransaction.indexOf('FROM "Conversation" AS conversation');
    const timestamp = sendTransaction.indexOf("const messageSentAt = new Date()");
    const messageCreate = sendTransaction.indexOf("await tx.message.create");

    assert.ok(pairLock > -1 && pairLock < messageCreate);
    assert.ok(conversationLock > pairLock && conversationLock < timestamp);
    assert.ok(timestamp < messageCreate);
    assert.match(sendTransaction, /FROM "Conversation" AS conversation[\s\S]{0,260}FOR UPDATE/);
    assert.match(access, /ORDER BY start_user\.id\s+FOR SHARE/);
    assert.match(deletion, /FROM "User" AS deletion_user[\s\S]{0,180}FOR UPDATE/);
    assert.equal(
      (sendTransaction.match(/createdAt: messageSentAt/g) ?? []).length,
      2,
      "text and attachment rows must use the post-lock timestamp instead of transaction-start now()",
    );
    assert.doesNotMatch(access, /pg_advisory_xact_lock/);
    assert.match(
      source("docs/rls-drafts/conversation-message-service-authority.sql"),
      /grainline_conversation_get_or_create_core[\s\S]*pg_catalog\.pg_advisory_xact_lock/,
    );
  });

  it("serializes every structured Message writer and keeps thread time monotonic", () => {
    const access = source("src/lib/conversationStartAccess.ts");
    const request = source("src/lib/customOrderRequestAccess.ts");
    const commission = source("src/lib/commissionInterestMessageAccess.ts");
    const ready = source("src/lib/customOrderReadyLink.ts");
    const thread = source("src/app/messages/[id]/page.tsx");
    const authority = source("src/lib/conversationMessageAuthority.ts");
    const serviceSql = source("docs/rls-drafts/conversation-message-service-authority.sql");
    const customFunction = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_send_custom_request"),
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_create_commission_interest"),
    );
    const commissionFunction = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_create_commission_interest"),
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_send_custom_order_ready"),
    );
    const readyFunction = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_send_custom_order_ready"),
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_account_deletion_email_key_core"),
    );

    assert.match(access, /export async function lockConversationForMessageWrite/);
    assert.match(access, /FOR UPDATE/);
    assert.match(request, /sendActorCustomOrderRequest\(input\)/);
    assert.match(commission, /createActorCommissionInterest\(input\)/);
    assert.match(authority, /public\.grainline_message_send_custom_request/);
    assert.match(authority, /public\.grainline_message_create_commission_interest/);
    assert.match(authority, /public\.grainline_message_send_custom_order_ready/);
    for (const writer of [customFunction, commissionFunction, readyFunction]) {
      assert.match(writer, /FOR UPDATE/);
      assert.match(writer, /message_sent_at := pg_catalog\.timezone\('UTC', pg_catalog\.clock_timestamp\(\)\)/);
      assert.match(writer, /INSERT INTO public\."Message"/);
    }
    assert.match(ready, /sendActorCustomOrderReady\(/);
    assert.doesNotMatch(ready, /prisma\.(?:conversation|message)\./);
    assert.match(thread, /kind: "file"/);
  });

  it("keeps the mobile thread edge-to-edge without horizontal panning", () => {
    const page = source("src/app/messages/[id]/page.tsx");
    const thread = source("src/components/ThreadMessages.tsx");
    const composer = source("src/components/MessageComposer.tsx");
    const loading = source("src/app/messages/[id]/loading.tsx");

    assert.match(page, /overflow-x-clip bg-\[#F7F5F0\]/);
    assert.match(page, /min-w-0 space-y-4 px-0 pt-4 sm:px-5/);
    assert.match(page, /className="w-full min-w-0 max-w-full"/);
    assert.match(thread, /touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain px-4/);
    assert.match(thread, /inline-block max-w-full break-all/);
    assert.match(composer, /flex w-full min-w-0 items-end gap-2/);
    assert.match(composer, /className="min-w-0 flex-1 resize-none/);
    assert.doesNotMatch(composer, /className="w-full resize-none/);
    assert.match(loading, /overflow-x-clip bg-\[#F7F5F0\]/);
  });

  it("keeps thread GET rendering read-only and bounds archive state mutations", () => {
    const page = source("src/app/messages/[id]/page.tsx");
    const readRoute = source("src/app/api/messages/[id]/read/route.ts");
    const authority = source("src/lib/conversationMessageAuthority.ts");
    const rateLimits = source("src/lib/ratelimit.ts");

    assert.doesNotMatch(page, /markOwnerMessageNotificationsRead/);
    assert.match(
      readRoute,
      /await markActorConversationMessagesRead\(me\.id, id\);[\s\S]*await markOwnerMessageNotificationsRead\(me\.id, id\)/,
    );
    assert.match(authority, /public\.grainline_message_mark_read/);
    assert.doesNotMatch(readRoute, /prisma\.message\.(?:find|update|create|delete)/);
    assert.match(readRoute, /getExplicitCrossOriginPostRejection\(req\)/);
    assert.match(readRoute, /safeRateLimit\(markReadRatelimit/);
    assert.match(rateLimits, /conversationStateRatelimit[\s\S]{0,180}slidingWindow\(60, "60 m"\)/);
    assert.equal((page.match(/safeRateLimit\(conversationStateRatelimit, me\.id\)/g) ?? []).length, 2);
  });

  it("keeps long-thread and inbox reads on bounded stable keyset windows", () => {
    const page = source("src/app/messages/[id]/page.tsx");
    const inbox = source("src/app/messages/page.tsx");
    const thread = source("src/components/ThreadMessages.tsx");
    const list = source("src/app/api/messages/[id]/list/route.ts");
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260722190000_prepare_conversation_message_scale_indexes/migration.sql");

    assert.match(page, /take: 201/);
    assert.match(page, /initialHasMoreBefore=\{hasMoreMessagesBefore\}/);
    assert.match(thread, /Load earlier messages/);
    assert.match(thread, /appendCursorParams\(url, cursor, "before"\)/);
    assert.match(list, /MESSAGE_POLL_LIMIT \+ 1/);
    assert.match(inbox, /take: 51/);
    assert.match(inbox, /Older conversations/);
    assert.match(inbox, /updatedAt: pageCursor\.createdAt, id: \{ lt: pageCursor\.id! \}/);
    assert.match(schema, /@@index\(\[conversationId, createdAt\(sort: Desc\), id\(sort: Desc\)\]\)/);
    assert.match(migration, /Message_conversationId_createdAt_id_idx/);
    assert.match(migration, /Conversation_userAId_updatedAt_id_idx/);
    assert.match(migration, /Conversation_userBId_updatedAt_id_idx/);
  });

  it("preserves listing context per message when a participant pair reuses one thread", () => {
    const newPage = source("src/app/messages/new/page.tsx");
    const threadPage = source("src/app/messages/[id]/page.tsx");
    const composer = source("src/components/MessageComposer.tsx");
    const thread = source("src/components/ThreadMessages.tsx");
    const access = source("src/lib/conversationStartAccess.ts");
    const requestAccess = source("src/lib/customOrderRequestAccess.ts");
    const readyAccess = source("src/lib/customOrderReadyLink.ts");
    const schema = source("prisma/schema.prisma");
    const contextMigration = source("prisma/migrations/20260722184500_add_message_listing_context/migration.sql");
    const indexMigration = source("prisma/migrations/20260722190000_prepare_conversation_message_scale_indexes/migration.sql");

    assert.ok(
      newPage.indexOf("canAttachConversationContextListing(contextListing") <
        newPage.indexOf("const existing = await findActorConversationPair"),
      "listing context must be validated before redirecting into an existing pair thread",
    );
    assert.match(newPage, /redirect\(`\/messages\/\$\{existing\.id\}\$\{listingQuery\}`\)/);
    assert.match(newPage, /redirect\(`\/messages\/\$\{result\.conversationId\}\$\{listingQuery\}`\)/);
    assert.match(access, /lockConversationContextListingForPair/);
    assert.match(access, /listing\."reservedForUserId" IN \(\$\{pair\.userAId\}, \$\{pair\.userBId\}\)/);
    assert.match(access, /listing\."reservedForUserId" <> seller\."userId"/);
    assert.match(threadPage, /lockConversationContextListingForPair\([\s\S]*submittedContextListingId/);
    assert.equal((threadPage.match(/contextListingId: committedContextListingId/g) ?? []).length, 2);
    assert.match(composer, /name="contextListingId"/);
    assert.match(thread, /Regarding \{m\.contextListing\.title\}/);
    assert.match(requestAccess, /sendActorCustomOrderRequest\(input\)/);
    assert.match(
      source("src/lib/conversationMessageAuthority.ts"),
      /\$\{input\.listingId\}::text/,
    );
    assert.match(readyAccess, /sendActorCustomOrderReady\(/);
    assert.match(
      source("docs/rls-drafts/conversation-message-service-authority.sql"),
      /"contextListingId"[\s\S]*source_listing\.id/,
    );
    assert.match(schema, /contextListing\s+Listing\?\s+@relation\("MessageContextListing"/);
    assert.match(contextMigration, /ADD COLUMN "contextListingId" TEXT/);
    assert.match(contextMigration, /Message_contextListingId_fkey/);
    assert.match(indexMigration, /Message_contextListingId_idx/);
  });

  it("records every pre-RLS finding and isolates the authority release", () => {
    const audit = source("docs/conversation-message-pre-rls-audit.md");
    for (let finding = 1; finding <= 19; finding += 1) {
      assert.match(audit, new RegExp(`CM-A${String(finding).padStart(2, "0")}`));
    }
    assert.match(
      audit,
      /Conversation\/Message RLS remains disabled with zero policies; no[\s\S]*Conversation or Message policy or authority SQL has been applied/,
    );
    assert.match(
      audit,
      /Policy\/function SQL, grant narrowing, initial RLS[\s\S]*activation and FORCE remain a separate Extra-High review and release/,
    );
  });
});

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
    assert.match(access, /TransactionIsolationLevel\.ReadCommitted/);
    assert.match(access, /ORDER BY start_user\.id\s+FOR SHARE/);
    assert.match(access, /block\.findFirst/);
    assert.match(access, /pg_advisory_xact_lock/);
    assert.ok(
      access.indexOf("FOR SHARE") < access.indexOf("block.findFirst"),
      "pair locks must precede the reciprocal block absence check",
    );
    assert.ok(
      access.indexOf("block.findFirst") < access.indexOf("conversation.create"),
      "conversation creation must follow the locked block check",
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
    assert.ok(
      access.indexOf("export async function getOrCreateConversationForLockedPair") <
        access.indexOf("pg_advisory_xact_lock"),
      "only create/get should take the pair advisory lock; ordinary sends serialize on the Conversation row",
    );
  });

  it("serializes every structured Message writer and keeps thread time monotonic", () => {
    const access = source("src/lib/conversationStartAccess.ts");
    const request = source("src/lib/customOrderRequestAccess.ts");
    const commission = source("src/lib/commissionInterestMessageAccess.ts");
    const ready = source("src/lib/customOrderReadyLink.ts");
    const thread = source("src/app/messages/[id]/page.tsx");

    assert.match(access, /export async function lockConversationForMessageWrite/);
    assert.match(access, /FOR UPDATE/);
    for (const writer of [request, commission]) {
      assert.match(writer, /lockConversationForMessageWrite/);
      assert.match(writer, /const messageSentAt = new Date\(\)/);
      assert.match(writer, /createdAt: messageSentAt/);
      assert.match(writer, /updatedAt: messageSentAt, archivedAAt: null, archivedBAt: null/);
    }
    assert.match(ready, /FOR SHARE OF listing, seller/);
    assert.match(ready, /lockConversationForMessageWrite\(tx, pair, source\.conversationId\)/);
    assert.match(ready, /createdAt: messageSentAt/);
    assert.match(ready, /updatedAt: messageSentAt, archivedAAt: null, archivedBAt: null/);
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
    const rateLimits = source("src/lib/ratelimit.ts");

    assert.doesNotMatch(page, /markOwnerMessageNotificationsRead/);
    assert.match(readRoute, /await prisma\.message\.updateMany\([\s\S]*await markOwnerMessageNotificationsRead\(me\.id, id\)/);
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
        newPage.indexOf("const existing = await prisma.conversation.findUnique"),
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
    assert.match(requestAccess, /contextListingId: listingId/);
    assert.match(readyAccess, /contextListingId: source\.listingId/);
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

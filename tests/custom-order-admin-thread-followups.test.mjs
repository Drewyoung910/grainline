import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("custom-order and staff-thread audit follow-ups", () => {
  it("sends custom-order ready links from both immediate and admin approval paths", () => {
    const helper = source("src/lib/customOrderReadyLink.ts");
    const authority = source("src/lib/conversationMessageAuthority.ts");
    const serviceSql = source("docs/rls-drafts/conversation-message-service-authority.sql");
    const readyFunction = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_send_custom_order_ready"),
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_account_deletion_email_key_core"),
    );
    const customPage = source("src/app/dashboard/listings/custom/page.tsx");
    const adminReview = source("src/app/api/admin/listings/[id]/review/route.ts");

    assert.match(helper, /dedupScope: source\.listingId/);
    assert.match(helper, /sendCustomOrderReady/);
    assert.match(helper, /sendActorCustomOrderReady\(/);
    assert.match(authority, /public\.grainline_message_send_custom_order_ready/);
    assert.match(readyFunction, /pg_catalog\.pg_advisory_xact_lock\(\s*913349/);
    assert.match(readyFunction, /pg_catalog\.hashtext\(p_listing_id\)/);
    assert.match(helper, /sendCustomOrderReadyLink\(\{ listingId \}: \{ listingId: string \}\)/);
    assert.doesNotMatch(helper, /conversationId,\s*sellerUserId,\s*buyerUserId,\s*sellerName,\s*listing,/);
    assert.match(readyFunction, /listing\."reservedForUserId" = initial_source\.buyer_user_id/);
    assert.match(readyFunction, /listing\."customOrderConversationId" = initial_source\.conversation_id/);
    assert.match(readyFunction, /existing_message\.message_count <> 1/);
    assert.match(readyFunction, /'custom_order_link',\s*true,\s*message_sent_at/);
    assert.match(helper, /existing valid message heals a prior post-commit notification failure/);
    assert.match(customPage, /sendCustomOrderReadyLink\(\{\s*listingId: created\.id,\s*\}\)/);
    assert.match(adminReview, /listing\.customOrderConversationId && listing\.reservedForUserId/);
    assert.equal((adminReview.match(/sendCustomOrderReadyLink\(\{\s*listingId:/g) ?? []).length, 2);
    assert.match(adminReview, /currentListing\.status === 'ACTIVE' &&[\s\S]*currentListing\.customOrderConversationId &&[\s\S]*currentListing\.reservedForUserId/);
  });

  it("lets staff view reported message threads without becoming a participant", () => {
    const threadPage = source("src/app/messages/[id]/page.tsx");
    const recipientSql = source("docs/rls-drafts/conversation-message-recipient-access.sql");

    assert.match(threadPage, /const isStaff = me\.role === "ADMIN" \|\| me\.role === "EMPLOYEE"/);
    assert.match(threadPage, /targetType: "MESSAGE_THREAD", targetId: id, resolved: false/);
    assert.match(threadPage, /getActorConversation\(me\.id, id\)/);
    assert.match(recipientSql, /public\.grainline_conversation_staff_report_visible\(conversation\.id\)/);
    assert.match(threadPage, /const isStaffReviewMode = canStaffReviewThread && !isParticipant/);
    assert.match(threadPage, /\{isParticipant && <MarkReadClient id=\{id\} \/>\}/);
    assert.match(threadPage, /isParticipant && !otherUnavailableReason/);
    assert.match(threadPage, /Staff review/);
  });

  it("keeps message thread side effects observable and account-state guarded", () => {
    const customOrderRoute = source("src/app/api/messages/custom-order-request/route.ts");
    const customOrderAccess = source("src/lib/customOrderRequestAccess.ts");
    const serviceSql = source("docs/rls-drafts/conversation-message-service-authority.sql");
    const customRequestFunction = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_send_custom_request"),
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_create_commission_interest"),
    );
    const threadPage = source("src/app/messages/[id]/page.tsx");

    assert.match(customOrderRoute, /Sentry\.captureException\(error, \{/);
    assert.match(customOrderRoute, /source: "custom_order_request_notification"/);
    assert.match(customOrderRoute, /source: "custom_order_request_email"/);
    assert.doesNotMatch(customOrderRoute, /catch\s*\{\s*\/\* non-fatal \*\/\s*\}/);

    assert.ok(
      customOrderRoute.indexOf("Budget must be a valid dollar amount") <
        customOrderRoute.indexOf("createCustomOrderRequestMessage({"),
      "custom order budget validation must run before entering the atomic write helper",
    );
    assert.match(customOrderRoute, /z\.enum\(\["no_rush", "2_months", "1_month", "2_weeks"\]\)/);
    assert.match(customOrderAccess, /sendActorCustomOrderRequest\(input\)/);
    assert.match(customRequestFunction, /p_description IS NULL/);
    assert.match(customRequestFunction, /pg_catalog\.char_length\(p_description\) > 500/);
    assert.ok(
      customRequestFunction.indexOf("p_description IS NULL") <
        customRequestFunction.indexOf("grainline_conversation_get_or_create_core"),
      "database payload validation must precede conversation creation side effects",
    );
    assert.match(customRequestFunction, /transaction_isolation'\) <> 'read committed'/);

    assert.match(threadPage, /select: \{ id: true, banned: true, deletedAt: true \}/);
    assert.match(threadPage, /if \(me\.banned \|\| me\.deletedAt\) return \{ ok: false \};/);
  });

  it("rejects empty thread messages before bumping conversations and captures email failures", () => {
    const threadPage = source("src/app/messages/[id]/page.tsx");

    assert.match(threadPage, /if \(!body && atts\.length === 0\) \{/);
    assert.match(threadPage, /Write a message or attach a file\./);
    assert.ok(
      threadPage.indexOf("if (!body && atts.length === 0)") <
        threadPage.indexOf("const c = await prisma.conversation.findFirst"),
      "empty message guard should run before conversation lookup/update work",
    );
    assert.ok(
      threadPage.indexOf("if (!body && atts.length === 0)") <
        threadPage.indexOf("await prisma.conversation.update"),
      "empty message guard should run before bumping updatedAt",
    );
    assert.match(threadPage, /source: "message_thread_email"/);
    assert.match(threadPage, /extra: \{ conversationId: id, recipientId: committedRecipientId \}/);
  });

  it("atomically throttles new-message email notifications per conversation", () => {
    const schema = source("prisma/schema.prisma");
    const threadPage = source("src/app/messages/[id]/page.tsx");

    assert.match(schema, /lastMessageEmailSentAt\s+DateTime\?/);
    assert.doesNotMatch(threadPage, /const recentReply = await prisma\.message\.findFirst/);
    assert.match(threadPage, /const emailWindowStart = new Date\(committedMessageSentAt\.getTime\(\) - 5 \* 60 \* 1000\)/);
    assert.match(threadPage, /const emailClaim = await prisma\.conversation\.updateMany\(\{/);
    assert.match(threadPage, /OR: \[\{ lastMessageEmailSentAt: null \}, \{ lastMessageEmailSentAt: \{ lt: emailWindowStart \} \}\]/);
    assert.match(threadPage, /data: \{ lastMessageEmailSentAt: committedMessageSentAt \}/);
    assert.match(threadPage, /if \(emailClaim\.count === 1\) \{/);
    assert.ok(
      threadPage.indexOf("const emailClaim = await prisma.conversation.updateMany") <
        threadPage.indexOf("await sendNewMessageEmail"),
      "email send should only happen after the atomic throttle claim succeeds",
    );
  });

  it("sets firstResponseAt through a null-preconditioned update", () => {
    const threadPage = source("src/app/messages/[id]/page.tsx");

    assert.match(threadPage, /conversation\.updateMany\(\{\s*where: \{ id, firstResponseAt: null \}/s);
    assert.match(threadPage, /data: \{ firstResponseAt: messageSentAt \}/);
    assert.doesNotMatch(threadPage, /conversationUpdate\.firstResponseAt = new Date\(\)/);
  });

  it("bounds stable message cursors before recipient-RPC keyset filters", () => {
    const listRoute = source("src/app/api/messages/[id]/list/route.ts");
    const streamRoute = source("src/app/api/messages/[id]/stream/route.ts");
    const authority = source("src/lib/conversationMessageAuthority.ts");
    const recipientSql = source("docs/rls-drafts/conversation-message-recipient-access.sql");
    const cursor = source("src/lib/messageCursor.ts");
    const limits = source("src/lib/messagePolling.ts");

    assert.match(limits, /export const MESSAGE_POLL_LIMIT = 200/);

    assert.match(listRoute, /const sinceRaw = url\.searchParams\.get\("since"\)/);
    assert.match(listRoute, /const sinceIdRaw = url\.searchParams\.get\("sinceId"\)/);
    assert.match(listRoute, /parseMessageCursor\(sinceRaw, sinceIdRaw\)/);
    assert.match(listRoute, /parseMessageCursor\(beforeRaw, beforeIdRaw, \{ requireId: true \}\)/);
    assert.match(listRoute, /import \{ MESSAGE_POLL_LIMIT \} from "@\/lib\/messagePolling"/);
    assert.match(listRoute, /direction: historyMode \? "before" : "after"/);
    assert.match(listRoute, /cursor: beforeCursor \?\? sinceCursor/);
    assert.match(listRoute, /limit: historyMode \? MESSAGE_POLL_LIMIT \+ 1 : MESSAGE_POLL_LIMIT/);
    assert.doesNotMatch(listRoute, /new Date\(Number\(since\)\)/);

    assert.match(streamRoute, /parseMessageCursor\(/);
    assert.match(streamRoute, /url\.searchParams\.get\("sinceId"\)/);
    assert.match(streamRoute, /import \{ MESSAGE_POLL_LIMIT \} from "@\/lib\/messagePolling"/);
    assert.match(streamRoute, /direction: "after"/);
    assert.match(streamRoute, /limit: MESSAGE_POLL_LIMIT/);
    assert.doesNotMatch(streamRoute, /Number\(url\.searchParams\.get\("since"\)/);
    assert.match(authority, /public\.grainline_message_list/);
    const messageListSql = recipientSql.slice(
      recipientSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_list"),
      recipientSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_unread_count"),
    );
    assert.match(messageListSql, /p_direction NOT IN \('before', 'after'\)/);
    assert.match(messageListSql, /ORDER BY message\."createdAt" DESC, message\.id DESC/);
    assert.match(messageListSql, /ORDER BY message\."createdAt" ASC, message\.id ASC/);
    assert.match(messageListSql, /bounded_limit := GREATEST\(1, LEAST\(COALESCE\(p_limit, 50\), 201\)\)/);
    assert.match(cursor, /createdAt: cursor\.createdAt, id: \{ gt: cursor\.id \}/);
    assert.match(cursor, /createdAt: cursor\.createdAt, id: \{ lt: cursor\.id \}/);
  });

  it("keeps message stream cleanup safe after client aborts", () => {
    const streamRoute = source("src/app/api/messages/[id]/stream/route.ts");

    assert.match(streamRoute, /safeEnqueue/);
    assert.match(streamRoute, /closeStream/);
    assert.match(streamRoute, /controller\.close\(\)/);
    assert.match(streamRoute, /catch \{\s*\/\/ The client may already have closed the stream/s);
    assert.match(streamRoute, /addEventListener\("abort", closeStream, \{ once: true \}\)/);
  });
});

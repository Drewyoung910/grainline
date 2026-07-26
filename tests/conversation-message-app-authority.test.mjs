import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Conversation and Message application authority conversion", () => {
  it("uses one fixed typed wrapper per converted read or mark-read operation", () => {
    const helper = source("src/lib/conversationMessageAuthority.ts");

    for (const functionName of [
      "grainline_conversation_get",
      "grainline_message_list",
      "grainline_message_unread_count",
      "grainline_message_mark_read",
      "grainline_message_export",
      "grainline_message_report_target_valid",
      "grainline_conversation_pair",
      "grainline_message_latest_custom_request",
    ]) {
      assert.match(helper, new RegExp(`public\\.${functionName}`));
    }
    assert.match(helper, /normalizeDbUserContextUserId\(userId\)/);
    assert.match(helper, /conversation recipient RPC returned multiple rows/);
    assert.match(helper, /message recipient RPC returned an invalid row/);
    assert.match(helper, /requireSafeCount\(rows\[0\]\.count, "message unread RPC"\)/);
    assert.match(helper, /\$\{label\} returned an invalid count/);
    assert.match(helper, /if \(!isBoundedAuthorityId\(conversationId\)\) return null/);
    assert.match(helper, /limit > 201/);
    assert.doesNotMatch(helper, /functionName|function_name|Prisma\.raw|\$queryRawUnsafe/);
    assert.doesNotMatch(helper, /FROM public\."(?:Conversation|Message)"/);
  });

  it("preserves list cursor bounds, staff review, and participant-only stream/read writes", () => {
    const list = source("src/app/api/messages/[id]/list/route.ts");
    const stream = source("src/app/api/messages/[id]/stream/route.ts");
    const read = source("src/app/api/messages/[id]/read/route.ts");

    assert.match(list, /getActorConversation\(me\.id, id\)/);
    assert.match(list, /listActorMessages\(me\.id, id/);
    assert.match(list, /direction: historyMode \? "before" : "after"/);
    assert.match(list, /MESSAGE_POLL_LIMIT \+ 1/);
    assert.match(list, /rows\.slice\(0, MESSAGE_POLL_LIMIT\)\.reverse\(\)/);

    for (const route of [stream, read]) {
      assert.match(route, /conversation\.userAId === me\.id/);
      assert.match(route, /conversation\.userBId === me\.id/);
    }
    assert.match(stream, /listActorMessages\(me\.id, id/);
    assert.match(stream, /direction: "after"/);
    assert.match(read, /markActorConversationMessagesRead\(me\.id, id\)/);
    assert.match(read, /markOwnerMessageNotificationsRead\(me\.id, id\)/);

    for (const route of [list, stream, read]) {
      assert.doesNotMatch(route, /prisma\.(?:conversation|message)\./);
    }
  });

  it("routes initial participant or reported-staff thread reads through bounded projections", () => {
    const helper = source("src/lib/conversationMessageAuthority.ts");
    const page = source("src/app/messages/[id]/page.tsx");
    const renderStart = page.indexOf("const conversation = await getActorConversation(me.id, id)");
    const renderEnd = page.indexOf("// --- Server actions", renderStart);
    const render = page.slice(renderStart, renderEnd);

    assert.ok(renderStart >= 0);
    assert.match(render, /listLatestActorMessages\(me\.id, conversation, 201\)/);
    assert.match(render, /const messages = messageRows\.slice\(-200\)/);
    assert.doesNotMatch(render, /prisma\.(?:conversation|message)\./);
    assert.match(helper, /new Date\(conversation\.updatedAt\.getTime\(\) \+ 1\)/);
    assert.match(helper, /direction: "before"/);
    assert.match(helper, /return rows\.reverse\(\)/);
  });

  it("moves unread counting behind the visible-thread recipient projection", () => {
    const route = source("src/app/api/messages/unread-count/route.ts");
    const helper = source("src/lib/conversationMessageAuthority.ts");

    assert.match(route, /countActorUnreadMessages\(me\.id\)/);
    assert.match(helper, /grainline_message_unread_count/);
    assert.doesNotMatch(route, /prisma\.message\.count|getBlockedUserIdsFor/);
  });

  it("moves the inbox, search, latest message, block filter, and unread grouping into one projection", () => {
    const helper = source("src/lib/conversationMessageAuthority.ts");
    const inbox = source("src/app/messages/page.tsx");
    const recipientSql = source("docs/rls-drafts/conversation-message-recipient-access.sql");
    const inboxFunction = recipientSql.slice(
      recipientSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_conversation_inbox"),
      recipientSql.indexOf("REVOKE ALL ON FUNCTION", recipientSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_conversation_inbox")),
    );

    assert.match(inbox, /listActorConversationInbox\(me\.id/);
    assert.match(inbox, /archived: isArchivedTab/);
    assert.match(inbox, /query: q/);
    assert.match(inbox, /cursor: pageCursor/);
    assert.match(inbox, /limit: 51/);
    assert.doesNotMatch(inbox, /prisma\.(?:conversation|message)\.|getBlockedUserIdsFor/);
    assert.match(helper, /public\.grainline_conversation_inbox/);
    assert.match(helper, /conversation inbox RPC returned an invalid row/);
    assert.match(helper, /conversation inbox unread count/);
    assert.match(helper, /limit > 51/);
    assert.match(inboxFunction, /p_user_id IN \(conversation\."userAId", conversation\."userBId"\)/);
    assert.match(inboxFunction, /NOT EXISTS \(\s*SELECT 1\s*FROM public\."Block"/s);
    assert.match(inboxFunction, /JOIN LATERAL \(\s*SELECT[\s\S]*FROM public\."Message"/);
    assert.match(inboxFunction, /searched_message\.body ILIKE search_pattern ESCAPE/);
  });

  it("keeps account export and report validation on actor-scoped projections", () => {
    const helper = source("src/lib/conversationMessageAuthority.ts");
    const accountExport = source("src/app/api/account/export/route.ts");
    const report = source("src/app/api/users/[id]/report/route.ts");

    assert.match(accountExport, /exportActorMessages\(user\.id\)/);
    assert.match(accountExport, /message\.senderId === user\.id/);
    assert.match(accountExport, /message\.recipientId === user\.id/);
    assert.match(report, /isActorMessageReportTarget\(/);
    assert.match(helper, /message report-target RPC returned an invalid result/);
    assert.doesNotMatch(accountExport, /prisma\.message\./);
    assert.doesNotMatch(report, /prisma\.(?:message|conversation)\./);
  });

  it("preserves deletion media before fixed database-derived message redaction", () => {
    const helper = source("src/lib/conversationMessageAuthority.ts");
    const deletion = source("src/lib/accountDeletion.ts");
    const collectCall = deletion.indexOf(
      "const mediaUrls = await collectAccountDeletionMediaUrls(tx, user.id, user.clerkId)",
    );
    const redactionCall = deletion.indexOf(
      "await redactActorMessagesForAccountDeletion(user.id, tx)",
    );

    assert.match(helper, /listActorSentMessageBodiesForDeletion/);
    assert.match(helper, /FROM public\.grainline_message_export/);
    assert.match(helper, /WHERE message_export\."senderId" = \$\{actorId\}::text/);
    assert.match(helper, /account-deletion message media projection returned an invalid row/);
    assert.match(helper, /public\.grainline_message_redact_for_account_deletion/);
    assert.match(helper, /requireSafeCount\(\s*rows\[0\]\.sentRedacted/s);
    assert.match(helper, /requireSafeCount\(\s*rows\[0\]\.receivedRedacted/s);
    assert.match(deletion, /listActorSentMessageBodiesForDeletion\(userId, db\)/);
    assert.ok(collectCall >= 0, "deletion must collect attachment URLs");
    assert.ok(redactionCall > collectCall, "message attachments must be collected before body redaction");
    assert.doesNotMatch(deletion, /(?:tx|db)\.message\.|FROM "Message"/);
  });

  it("moves custom-order participant context and pair lookups behind exact projections", () => {
    const helper = source("src/lib/conversationMessageAuthority.ts");
    const customListing = source("src/app/dashboard/listings/custom/page.tsx");
    const order = source("src/app/dashboard/orders/[id]/page.tsx");

    assert.equal(
      (customListing.match(/getActorConversation\(me\.id, conversationId\)/g) ?? []).length,
      2,
    );
    assert.match(customListing, /findLatestActorCustomOrderRequest\(/);
    assert.match(customListing, /convo\.userAId === me\.id/);
    assert.match(customListing, /convo\.userBId === me\.id/);
    assert.match(order, /findActorConversationPair\(me\.id, sellerUserId\)/);
    const newMessage = source("src/app/messages/new/page.tsx");
    const startAccess = source("src/lib/conversationStartAccess.ts");
    assert.match(newMessage, /findActorConversationPair\(me\.id, other\.id\)/);
    assert.match(startAccess, /startActorConversation\(/);
    assert.match(helper, /public\.grainline_conversation_start/);
    assert.match(helper, /conversation start RPC returned an invalid row/);
    assert.match(helper, /custom-request RPC returned an invalid row/);
    assert.match(helper, /conversation pair RPC returned an invalid result/);
    assert.doesNotMatch(customListing, /prisma\.(?:conversation|message)\./);
    assert.doesNotMatch(order, /prisma\.conversation\./);
    assert.doesNotMatch(newMessage, /prisma\.conversation\./);
  });

  it("routes structured message writes through fixed source-bound functions", () => {
    const helper = source("src/lib/conversationMessageAuthority.ts");
    const customAccess = source("src/lib/customOrderRequestAccess.ts");
    const commissionAccess = source("src/lib/commissionInterestMessageAccess.ts");
    const readyAccess = source("src/lib/customOrderReadyLink.ts");
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

    assert.match(helper, /public\.grainline_message_send_custom_request/);
    assert.match(helper, /public\.grainline_message_create_commission_interest/);
    assert.match(helper, /public\.grainline_message_send_custom_order_ready/);
    assert.match(customAccess, /sendActorCustomOrderRequest\(input\)/);
    assert.match(commissionAccess, /createActorCommissionInterest\(input\)/);
    assert.match(readyAccess, /sendActorCustomOrderReady\(/);
    assert.doesNotMatch(customAccess, /prisma\.(?:conversation|message)\./);
    assert.doesNotMatch(commissionAccess, /prisma\.(?:conversation|message)\./);
    assert.doesNotMatch(readyAccess, /prisma\.(?:conversation|message)\./);

    for (const sql of [customFunction, commissionFunction, readyFunction]) {
      assert.match(sql, /transaction_isolation'\) <> 'read committed'/);
      assert.match(sql, /grainline_conversation_lock_pair_core/);
      assert.match(sql, /FOR UPDATE/);
      assert.match(sql, /INSERT INTO public\."Message"/);
    }
    assert.match(customFunction, /grainline_conversation_get_or_create_core/);
    assert.match(commissionFunction, /grainline_conversation_get_or_create_core/);
    assert.match(customFunction, /listing\."sellerId" = seller_profile_id/);
    assert.match(customFunction, /listing\."isPrivate" = false/);
    assert.match(customFunction, /'timelineLabel'/);
    assert.match(commissionFunction, /INSERT INTO public\."CommissionInterest"/);
    assert.match(commissionFunction, /UPDATE public\."CommissionRequest"/);
    assert.match(commissionFunction, /kind,\s*"isSystemMessage"/);
    assert.match(commissionFunction, /'commission_interest_card',\s*true/);
    assert.match(commissionFunction, /created := false/);
    assert.match(commissionFunction, /existing_message\.message_count <> 1/);
    assert.match(readyFunction, /listing\."reservedForUserId" = initial_source\.buyer_user_id/);
    assert.match(readyFunction, /listing\."customOrderConversationId" = initial_source\.conversation_id/);
    assert.match(readyFunction, /existing_message\.message_count <> 1/);
    assert.match(readyFunction, /created := false/);
  });

  it("routes seller response metrics through an aggregate-only authority function", () => {
    const helper = source("src/lib/conversationMessageAuthority.ts");
    const metrics = source("src/lib/metrics.ts");
    const serviceSql = source("docs/rls-drafts/conversation-message-service-authority.sql");
    const metricFunction = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_seller_message_response_metrics"),
      serviceSql.indexOf("REVOKE ALL ON FUNCTION"),
    );

    assert.match(metrics, /getSellerMessageResponseMetrics\(seller\.userId, periodStart, db\)/);
    assert.match(helper, /public\.grainline_seller_message_response_metrics/);
    assert.match(helper, /sellerRespondedCount > buyerInitiatedCount/);
    assert.doesNotMatch(metrics, /FROM "(?:Conversation|Message)"/);
    assert.match(metricFunction, /RETURNS TABLE \(\s*"buyerInitiatedCount" bigint,\s*"sellerRespondedCount" bigint\s*\)/);
    assert.match(metricFunction, /DISTINCT ON \(message\."conversationId"\)/);
    assert.match(metricFunction, /response\."senderId" = p_seller_user_id/);
    assert.match(metricFunction, /LEFT JOIN seller_response/);
  });
});

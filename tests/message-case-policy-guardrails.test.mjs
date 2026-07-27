import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("message and case policy guardrails", () => {
  it("revalidates custom-order ready links against conversation and block policy", () => {
    const helper = source("src/lib/customOrderReadyLink.ts");
    const serviceSql = source("docs/rls-drafts/conversation-message-service-authority.sql");
    const readyFunction = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_send_custom_order_ready"),
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_account_deletion_email_key_core"),
    );
    const pairLock = readyFunction.indexOf("grainline_conversation_lock_pair_core");
    const listingSourceLock = readyFunction.indexOf("FOR SHARE OF listing, seller");
    const conversationLock = readyFunction.indexOf('FROM public."Conversation" AS conversation');
    const messageCreate = readyFunction.indexOf('INSERT INTO public."Message"');

    assert.ok(pairLock > -1, "ready-link authority must lock and validate the participant pair");
    assert.ok(listingSourceLock > pairLock, "ready-link source rows must lock after the participant pair");
    assert.ok(
      conversationLock > listingSourceLock,
      "ready-link Conversation lock must follow Listing/Seller source locks",
    );
    assert.ok(messageCreate > conversationLock, "ready-link message must be created after policy locks");
    assert.match(helper, /sendActorCustomOrderReady\(/);
    assert.match(readyFunction, /listing\.status = 'ACTIVE'/);
    assert.match(readyFunction, /listing\."isPrivate" = true/);
    assert.match(readyFunction, /seller\."chargesEnabled" = true/);
    assert.match(readyFunction, /seller\."stripeAccountId" IS NOT NULL/);
    assert.match(readyFunction, /seller\."vacationMode" = false/);
    assert.match(readyFunction, /"contextListingId"/);
    assert.match(readyFunction, /'custom_order_link',\s*true,\s*message_sent_at/);
  });

  it("reopens pending-close cases before accepting a new party message", () => {
    const route = source("src/app/api/cases/[id]/messages/route.ts");

    assert.match(route, /caseMessageStatusTransition/);
    assert.match(route, /statusTransition === "party_reopened_pending_close"/);
    assert.match(
      route,
      /statusTransition === "party_reopened_pending_close"[\s\S]{0,180}status: "IN_DISCUSSION" as const/,
    );
    assert.match(route, /buyerMarkedResolved: false/);
    assert.match(route, /sellerMarkedResolved: false/);
  });

  it("keeps blocked and archived conversations out of visible unread counts before caps", () => {
    const inbox = source("src/app/messages/page.tsx");
    const unreadCount = source("src/app/api/messages/unread-count/route.ts");
    const recipientSql = source("docs/rls-drafts/conversation-message-recipient-access.sql");
    const inboxFunction = recipientSql.slice(
      recipientSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_conversation_inbox"),
      recipientSql.indexOf("REVOKE ALL ON FUNCTION", recipientSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_conversation_inbox")),
    );

    assert.match(inbox, /listActorConversationInbox\(me\.id/);
    assert.match(inbox, /limit: 51/);
    assert.match(inbox, /const hasMoreConversations = conversationRows\.length > 50/);
    assert.doesNotMatch(inbox, /getBlockedUserIdsFor|prisma\.(?:conversation|message)\./);
    assert.match(inboxFunction, /NOT EXISTS \(\s*SELECT 1\s*FROM public\."Block"/s);
    assert.match(inboxFunction, /JOIN LATERAL \(\s*SELECT[\s\S]*FROM public\."Message"/);
    assert.match(inboxFunction, /ORDER BY conversation\."updatedAt" DESC, conversation\.id DESC\s*LIMIT bounded_limit/);
    assert.match(inboxFunction, /unread_message\."recipientId" = p_user_id/);
    assert.match(inboxFunction, /unread_message\."readAt" IS NULL/);

    assert.match(unreadCount, /countActorUnreadMessages\(me\.id\)/);
    const unreadFunction = recipientSql.slice(
      recipientSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_unread_count"),
      recipientSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_latest_custom_request"),
    );
    assert.match(unreadFunction, /conversation\."archivedAAt" IS NULL/);
    assert.match(unreadFunction, /conversation\."archivedBAt" IS NULL/);
    assert.match(unreadFunction, /NOT EXISTS \(\s*SELECT 1\s*FROM public\."Block"/s);
    assert.match(unreadFunction, /block\."blockerId" = conversation\."userAId"/);
    assert.match(unreadFunction, /block\."blockedId" = conversation\."userBId"/);
  });

  it("loads the latest message-thread window and reopens archived threads on new content", () => {
    const threadPage = source("src/app/messages/[id]/page.tsx");
    const customOrderRequest = source("src/lib/customOrderRequestAccess.ts");
    const serviceSql = source("docs/rls-drafts/conversation-message-service-authority.sql");
    const invariantMigration = source(
      "prisma/migrations/20260722231500_enforce_conversation_message_invariants/migration.sql",
    );
    const customFunction = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_send_custom_request"),
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_create_commission_interest"),
    );

    assert.match(threadPage, /listLatestActorMessages\(me\.id, conversation, 201\)/);
    assert.match(threadPage, /const hasMoreMessagesBefore = messageRows\.length > 200/);
    assert.match(threadPage, /const messages = messageRows\.slice\(-200\)/);
    assert.match(threadPage, /sendActorOrdinaryMessage\(/);
    const ordinaryFunction = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_send_ordinary"),
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_conversation_set_archived"),
    );
    assert.match(ordinaryFunction, /INSERT INTO public\."Message"/);
    assert.match(customOrderRequest, /sendActorCustomOrderRequest\(input\)/);
    assert.match(customFunction, /message_sent_at := pg_catalog\.timezone\('UTC', pg_catalog\.clock_timestamp\(\)\)/);
    assert.match(customFunction, /INSERT INTO public\."Message"/);
    assert.match(invariantMigration, /CREATE TRIGGER grainline_message_maintain_thread_state/);
    assert.match(invariantMigration, /"archivedAAt" = NULL,\s*"archivedBAt" = NULL/);
  });

  it("revalidates message-thread send policy inside the write transaction", () => {
    const threadPage = source("src/app/messages/[id]/page.tsx");
    const serviceSql = source("docs/rls-drafts/conversation-message-service-authority.sql");
    const ordinaryFunction = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_message_send_ordinary"),
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_conversation_set_archived"),
    );
    const pairCore = serviceSql.slice(
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_conversation_lock_pair_core"),
      serviceSql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_conversation_listing_core"),
    );
    const pairLock = ordinaryFunction.indexOf("grainline_conversation_lock_pair_core");
    const listingLock = ordinaryFunction.indexOf("grainline_conversation_listing_core");
    const conversationLock = ordinaryFunction.indexOf('FROM public."Conversation" AS conversation', listingLock);
    const messageCreate = ordinaryFunction.indexOf('INSERT INTO public."Message"');

    assert.match(threadPage, /await prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(threadPage, /isolationLevel: "ReadCommitted"/);
    assert.match(threadPage, /c\.userAId !== me\.id && c\.userBId !== me\.id/);
    assert.ok(pairLock > -1 && pairLock < listingLock);
    assert.ok(listingLock < conversationLock && conversationLock < messageCreate);
    assert.match(pairCore, /account_user\.banned = false/);
    assert.match(pairCore, /FROM public\."Block" AS block/);
    assert.match(ordinaryFunction, /"recipientId" := CASE/);
    assert.match(threadPage, /createdAttachment\.recipientId !== recipientId/);
    assert.match(threadPage, /createdText\.recipientId !== recipientId/);
    assert.match(threadPage, /userId: committedRecipientId/);
    assert.match(threadPage, /shouldSendEmail\(committedRecipientId, "EMAIL_NEW_MESSAGE"\)/);
  });

  it("verifies uploaded message attachments at persistence time before creating messages", () => {
    const threadPage = source("src/app/messages/[id]/page.tsx");
    const helper = source("src/lib/uploadPersistenceVerification.ts");

    assert.match(threadPage, /verifyFirstPartyUploadForPersistence/);
    assert.match(threadPage, /claimDirectUploadForUrl/);
    assert.match(threadPage, /MESSAGE_ATTACHMENT_CONTENT_TYPES/);
    assert.match(threadPage, /endpoint: "messageAny"/);
    assert.ok(
      threadPage.indexOf("verifyFirstPartyUploadForPersistence") <
        threadPage.indexOf("const createdAttachment = await sendActorOrdinaryMessage"),
      "message attachments must be verified before message rows are created",
    );
    assert.ok(
      threadPage.indexOf("await claimDirectUploadForUrl({") <
        threadPage.indexOf("const createdAttachment = await sendActorOrdinaryMessage"),
      "tracked direct uploads must be claimed before attachment rows are created",
    );
    assert.match(helper, /export const MESSAGE_ATTACHMENT_CONTENT_TYPES/);
    assert.match(helper, /"application\/pdf"/);
    assert.match(helper, /IMAGE_UPLOAD_TYPES/);
  });

  it("keeps staff reported-thread review from starting participant-only live fetches", () => {
    const thread = source("src/components/ThreadMessages.tsx");
    const page = source("src/app/messages/[id]/page.tsx");

    assert.match(thread, /liveUpdates = true/);
    assert.match(thread, /liveUpdates\?: boolean/);
    assert.match(thread, /if \(!liveUpdates\) return;/);
    assert.match(thread, /if \(!liveUpdates\) \{\s*setStreamError\(null\);\s*return;\s*\}/s);
    assert.match(page, /liveUpdates=\{!isStaffReviewMode\}/);
  });

  it("keeps staff reported-thread review from rendering seller-only custom listing actions", () => {
    const thread = source("src/components/ThreadMessages.tsx");
    const page = source("src/app/messages/[id]/page.tsx");

    assert.match(thread, /canCreateCustomListings = true/);
    assert.match(thread, /canCreateCustomListings\?: boolean/);
    assert.match(thread, /const canCreateCustomListing = canCreateCustomListings && !mine/);
    assert.match(thread, /\{canCreateCustomListing && \(/);
    assert.match(page, /canCreateCustomListings=\{isParticipant && !otherUnavailableReason\}/);
  });

  it("keeps unavailable message-thread public links inert", () => {
    const page = source("src/app/messages/[id]/page.tsx");

    assert.match(page, /import \{ canViewListingDetail \} from "@\/lib\/listingVisibility"/);
    assert.match(page, /import \{ isSupportedStripeAccountVersion \} from "@\/lib\/sellerVisibility"/);
    assert.match(page, /const sellerProfileHref = !otherUnavailableReason &&/);
    assert.match(page, /otherSellerProfile\.chargesEnabled &&/);
    assert.match(page, /isSupportedStripeAccountVersion\(otherSellerProfile\.stripeAccountVersion\)/);
    assert.match(page, /const contextListingHref = ctx &&\s+canViewListingDetail\(ctx,/);
    assert.match(page, /href=\{contextListingHref\}/);
    assert.doesNotMatch(page, /href=\{publicListingPath\(ctx\.id, ctx\.title\)\}/);
    assert.match(page, /\) : ctx \? \(/);
  });

  it("hides buyer and seller case reply boxes when the API would reject the recipient", () => {
    for (const pagePath of [
      "src/app/dashboard/orders/[id]/page.tsx",
      "src/app/dashboard/sales/[orderId]/page.tsx",
    ]) {
      const page = source(pagePath);

      assert.match(page, /unavailableCaseMessageRecipientReason/);
      assert.match(page, /unavailableCaseRecipientMessage/);
      assert.match(page, /buyer: \{ select: \{ id: true, banned: true, deletedAt: true \} \}/);
      assert.match(page, /seller: \{ select: \{ id: true, banned: true, deletedAt: true \} \}/);
      assert.match(page, /caseReplyUnavailableMessage \? \(/);
      assert.match(
        page,
        /<CaseReplyBox[\s\S]*caseId=\{activeCase\.id\}[\s\S]*attachmentsEnabled=\{caseEvidenceAttachmentsEnabled\(\)\}[\s\S]*\/>/,
      );
    }
  });

  it("shows escalation controls when an unavailable case counterparty bypasses the timer", () => {
    const actionState = source("src/lib/caseActionState.ts");
    assert.match(actionState, /export function caseEscalationAvailable/);
    assert.match(actionState, /if \(counterpartyUnavailable\) return true/);

    for (const pagePath of [
      "src/app/dashboard/orders/[id]/page.tsx",
      "src/app/dashboard/sales/[orderId]/page.tsx",
    ]) {
      const page = source(pagePath);
      assert.match(page, /caseEscalationAvailable/);
      assert.match(page, /caseReplyUnavailableReason != null/);
      assert.match(page, /activeCase\.status === "OPEN"/);
      assert.match(page, /activeCase\.status !== "OPEN" && <CaseMarkResolvedButton/);
      assert.match(page, /<CaseEscalateButton caseId=\{activeCase\.id\} \/>/);
    }
  });

  it("does not derive cross-user notification display names from email local-parts", () => {
    for (const path of [
      "src/app/api/cases/route.ts",
      "src/app/api/cases/[id]/messages/route.ts",
      "src/app/api/messages/custom-order-request/route.ts",
      "src/app/api/reviews/route.ts",
      "src/app/api/favorites/route.ts",
      "src/app/admin/blog/page.tsx",
    ]) {
      const text = source(path);

      assert.doesNotMatch(text, /email\??\.split\(["']@["']\)/, `${path} must not use email local-parts`);
      assert.doesNotMatch(text, /split\(["']@["']\)\[0\]/, `${path} must not use email local-parts`);
    }
  });
});

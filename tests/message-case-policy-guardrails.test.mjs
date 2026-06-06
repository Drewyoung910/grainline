import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("message and case policy guardrails", () => {
  it("revalidates custom-order ready links against conversation and block policy", () => {
    const helper = source("src/lib/customOrderReadyLink.ts");
    const policyCheck = helper.indexOf("const conversation = await tx.conversation.findUnique");
    const messageCreate = helper.indexOf("await tx.message.create");

    assert.ok(policyCheck > -1, "ready-link helper must load conversation state inside the lock");
    assert.ok(messageCreate > policyCheck, "ready-link message must be created after policy checks");
    assert.match(helper, /import \{ messagingUnavailableReason \} from "@\/lib\/messageRecipientState";/);
    assert.match(helper, /sellerUserId === buyerUserId/);
    assert.match(helper, /!participants\.has\(sellerUserId\)/);
    assert.match(helper, /!participants\.has\(buyerUserId\)/);
    assert.match(helper, /messagingUnavailableReason\(sellerState\) \|\| messagingUnavailableReason\(buyerState\)/);
    assert.match(helper, /\{ blockerId: sellerUserId, blockedId: buyerUserId \}/);
    assert.match(helper, /\{ blockerId: buyerUserId, blockedId: sellerUserId \}/);
    assert.match(helper, /data: \{ updatedAt: new Date\(\), archivedAAt: null, archivedBAt: null \}/);
  });

  it("reopens pending-close cases before accepting a new party message", () => {
    const route = source("src/app/api/cases/[id]/messages/route.ts");

    assert.match(route, /caseMessageStatusTransition/);
    assert.match(route, /statusTransition === "party_reopened_pending_close"/);
    assert.match(route, /caseUpdates\.status = "IN_DISCUSSION"/);
    assert.match(route, /caseUpdates\.buyerMarkedResolved = false/);
    assert.match(route, /caseUpdates\.sellerMarkedResolved = false/);
  });

  it("keeps blocked and archived conversations out of visible unread counts before caps", () => {
    const inbox = source("src/app/messages/page.tsx");
    const unreadCount = source("src/app/api/messages/unread-count/route.ts");

    assert.match(inbox, /const blockedUserIdList = \[\.\.\.blockedUserIds\]/);
    assert.ok(
      inbox.indexOf("blockedUserIdList.length > 0") < inbox.indexOf("take: 50"),
      "messages inbox must exclude blocked users before the capped query",
    );
    assert.match(inbox, /orderBy: \[\{ updatedAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(inbox, /where: \{ recipientId: me\.id, readAt: null, conversation: \{ is: where \} \}/);

    assert.match(unreadCount, /getBlockedUserIdsFor/);
    assert.match(unreadCount, /archivedAAt: null/);
    assert.match(unreadCount, /archivedBAt: null/);
    assert.match(unreadCount, /userAId: \{ notIn: blockedUserIds \}/);
    assert.match(unreadCount, /userBId: \{ notIn: blockedUserIds \}/);
  });

  it("loads the latest message-thread window and reopens archived threads on new content", () => {
    const threadPage = source("src/app/messages/[id]/page.tsx");
    const customOrderRequest = source("src/app/api/messages/custom-order-request/route.ts");

    assert.match(threadPage, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\],\s*take: 200/);
    assert.match(threadPage, /\)\)\.reverse\(\)/);
    assert.match(threadPage, /data: \{ updatedAt: messageSentAt, archivedAAt: null, archivedBAt: null \}/);
    assert.match(customOrderRequest, /data: \{ updatedAt: new Date\(\), archivedAAt: null, archivedBAt: null \}/);
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
      assert.match(page, /<CaseReplyBox caseId=\{activeCase\.id\} \/>/);
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

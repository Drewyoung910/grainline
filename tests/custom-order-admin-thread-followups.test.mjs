import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("custom-order and staff-thread audit follow-ups", () => {
  it("sends custom-order ready links from both immediate and admin approval paths", () => {
    const helper = source("src/lib/customOrderReadyLink.ts");
    const customPage = source("src/app/dashboard/listings/custom/page.tsx");
    const adminReview = source("src/app/api/admin/listings/[id]/review/route.ts");

    assert.match(helper, /kind: "custom_order_link"/);
    assert.match(helper, /dedupScope: listing\.id/);
    assert.match(helper, /sendCustomOrderReady/);
    assert.match(helper, /pg_advisory_xact_lock/);
    assert.match(helper, /hashtext\(\$\{\`\$\{conversationId\}:\$\{listing\.id\}`\}\)/);
    assert.ok(
      helper.indexOf("const existingLinkMessage = await tx.message.findFirst") <
        helper.indexOf("await tx.message.create"),
      "custom order ready link duplicate check must run inside the locked transaction before message create",
    );
    assert.match(customPage, /sendCustomOrderReadyLink\(\{/);
    assert.match(adminReview, /listing\.customOrderConversationId && listing\.reservedForUserId/);
    assert.match(adminReview, /sendCustomOrderReadyLink\(\{/);
    assert.match(adminReview, /currentListing\.status === 'ACTIVE' &&[\s\S]*currentListing\.customOrderConversationId &&[\s\S]*currentListing\.reservedForUserId/);
  });

  it("lets staff view reported message threads without becoming a participant", () => {
    const threadPage = source("src/app/messages/[id]/page.tsx");

    assert.match(threadPage, /const isStaff = me\.role === "ADMIN" \|\| me\.role === "EMPLOYEE"/);
    assert.match(threadPage, /targetType: "MESSAGE_THREAD", targetId: id, resolved: false/);
    assert.match(threadPage, /where: canStaffReviewThread \? \{ id \} : \{ id, OR: \[\{ userAId: me\.id \}, \{ userBId: me\.id \}\] \}/);
    assert.match(threadPage, /const isStaffReviewMode = canStaffReviewThread && !isParticipant/);
    assert.match(threadPage, /\{isParticipant && <MarkReadClient id=\{id\} \/>\}/);
    assert.match(threadPage, /isParticipant && !otherUnavailableReason/);
    assert.match(threadPage, /Staff review/);
  });

  it("keeps message thread side effects observable and account-state guarded", () => {
    const customOrderRoute = source("src/app/api/messages/custom-order-request/route.ts");
    const threadPage = source("src/app/messages/[id]/page.tsx");

    assert.match(customOrderRoute, /Sentry\.captureException\(error, \{/);
    assert.match(customOrderRoute, /source: "custom_order_request_notification"/);
    assert.match(customOrderRoute, /source: "custom_order_request_email"/);
    assert.doesNotMatch(customOrderRoute, /catch\s*\{\s*\/\* non-fatal \*\/\s*\}/);

    assert.ok(
      customOrderRoute.indexOf("Budget must be a valid dollar amount") < customOrderRoute.indexOf("conversation.create"),
      "custom order budget validation must run before conversation creation side effects",
    );

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
    assert.match(threadPage, /extra: \{ conversationId: id, recipientId \}/);
  });

  it("sets firstResponseAt through a null-preconditioned update", () => {
    const threadPage = source("src/app/messages/[id]/page.tsx");

    assert.match(threadPage, /conversation\.updateMany\(\{\s*where: \{ id, firstResponseAt: null \}/s);
    assert.match(threadPage, /data: \{ firstResponseAt: messageSentAt \}/);
    assert.doesNotMatch(threadPage, /conversationUpdate\.firstResponseAt = new Date\(\)/);
  });

  it("bounds message polling since parameters before Prisma date filters", () => {
    const listRoute = source("src/app/api/messages/[id]/list/route.ts");
    const streamRoute = source("src/app/api/messages/[id]/stream/route.ts");

    assert.match(listRoute, /parseTimestampMsParam\(url\.searchParams\.get\("since"\)\)/);
    assert.match(listRoute, /const sinceDate = sinceMs == null \? null : new Date\(sinceMs\)/);
    assert.doesNotMatch(listRoute, /new Date\(Number\(since\)\)/);

    assert.match(streamRoute, /parseTimestampMsParam\(url\.searchParams\.get\("since"\)\) \?\? 0/);
    assert.doesNotMatch(streamRoute, /Number\(url\.searchParams\.get\("since"\)/);
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

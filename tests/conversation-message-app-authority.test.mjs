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

  it("moves unread counting behind the visible-thread recipient projection", () => {
    const route = source("src/app/api/messages/unread-count/route.ts");
    const helper = source("src/lib/conversationMessageAuthority.ts");

    assert.match(route, /countActorUnreadMessages\(me\.id\)/);
    assert.match(helper, /grainline_message_unread_count/);
    assert.doesNotMatch(route, /prisma\.message\.count|getBlockedUserIdsFor/);
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
});

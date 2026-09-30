import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

test("listing staff preview requires the session-bound admin PIN", () => {
  const page = source("src/app/listing/[id]/page.tsx");

  assert.match(page, /const \{ userId, sessionId \} = await auth\(\)/);
  assert.match(page, /staffPreview = await verifyAdminPinCookieValue\(/);
  assert.match(page, /cookieStore\.get\(ADMIN_PIN_COOKIE_NAME\)\?\.value/);
  assert.match(page, /userId,\s*sessionId,/s);
  assert.match(page, /staffPreview,\s*role: me\?\.role,/s);
  assert.doesNotMatch(page, /staffPreview: staffPreviewRequested/);
});

test("reported-thread page checks the PIN before querying users or messages", () => {
  const page = source("src/app/messages/[id]/page.tsx");
  const conversation = page.indexOf("const conversation = await getActorConversation(me.id, id)");
  const pin = page.indexOf("canStaffReviewThread = isActiveStaff && await verifyAdminPinCookieValue(");
  const rejection = page.indexOf("if (!canStaffReviewThread) return notFound();");
  const users = page.indexOf("const conversationUsers = await prisma.user.findMany");
  const messages = page.indexOf("const messageRows = await listLatestActorMessages");

  assert.ok(conversation >= 0);
  assert.ok(pin > conversation);
  assert.ok(rejection > pin);
  assert.ok(users > rejection);
  assert.ok(messages > rejection);
  assert.doesNotMatch(page, /prisma\.userReport\.findFirst/);
});

test("reported-thread polling requires the PIN while participant polling remains available", () => {
  const route = source("src/app/api/messages/[id]/list/route.ts");
  const conversation = route.indexOf("const conversation = await getActorConversation(me.id, id)");
  const participant = route.indexOf("const isParticipant = conversation.userAId === me.id");
  const pin = route.indexOf("const pinRejection = await requireStaffAdminPinForApi(req, userId, sessionId)");
  const list = route.indexOf("const rows = await listActorMessages(me.id, id");

  assert.match(route, /const \{ userId, sessionId \} = await auth\(\)/);
  assert.ok(conversation >= 0);
  assert.ok(participant > conversation);
  assert.ok(pin > participant);
  assert.ok(list > pin);
  assert.match(route, /if \(!isParticipant\) \{/);
});

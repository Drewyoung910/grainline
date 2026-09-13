import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function ordered(text, needles) {
  let previous = -1;
  for (const needle of needles) {
    const index = text.indexOf(needle);
    assert.ok(index >= 0, `${needle} is missing`);
    assert.ok(index > previous, `${needle} is out of order`);
    previous = index;
  }
}

const finalization = source("src/lib/orderRefundFinalization.ts");
const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
const webhookRoute = source("src/app/api/stripe/webhook/route.ts");

test("seller refund record, notification, and email reservation share one transaction", () => {
  const seller = finalization.slice(
    finalization.indexOf("export async function finalizeSellerOrderRefund"),
    finalization.indexOf(
      "export async function finalizeBlockedCheckoutOrderRefund",
    ),
  );

  assert.match(
    seller,
    /const committed = await prisma\.\$transaction\(async \(tx\) => \{/,
  );
  ordered(seller, [
    "recordSellerOrderRefund(input, tx)",
    "createNotificationOrThrow({",
    "const buyer = await tx.user.findUnique({",
    "enqueueEmailOutboxOnce(",
  ]);
  assert.match(seller, /type: "REFUND_ISSUED"/);
  assert.match(seller, /relatedUserId: input\.actorUserId/);
  assert.match(seller, /dedupKey: `refund-issued:\$\{sourceId\}`/);
  assert.match(seller, /templateName: "refund_issued"/);
  assert.match(seller, /preferenceKey: "EMAIL_REFUND_ISSUED"/);
  assert.match(seller, /sourceType: NOTIFICATION_SOURCE_TYPES\.ORDER_PAYMENT/);
  assert.equal((seller.match(/\},\s*tx,?\s*\);/g) ?? []).length, 2);
  assert.ok(
    seller.indexOf("processEmailOutboxJobById(committed.emailOutboxId)") >
      seller.indexOf("const committed = await prisma.$transaction"),
    "the immediate email attempt must run only after the durable transaction commits",
  );
  assert.doesNotMatch(sellerRoute, /sendRefundIssued|createNotification\(/);
  assert.equal(
    (sellerRoute.match(/finalizeSellerOrderRefund\(\{/g) ?? []).length,
    2,
  );
});

test("blocked-checkout refund record and participant delivery share one transaction", () => {
  const blocked = finalization.slice(
    finalization.indexOf(
      "export async function finalizeBlockedCheckoutOrderRefund",
    ),
  );

  assert.match(
    blocked,
    /const committed = await prisma\.\$transaction\(async \(tx\) => \{/,
  );
  ordered(blocked, [
    "recordBlockedCheckoutOrderRefund(input, tx)",
    "createNotificationOrThrow({",
    "const buyer = await tx.user.findUnique({",
    "enqueueEmailOutboxOnce(",
  ]);
  assert.match(blocked, /userId: result\.buyerUserId/);
  assert.match(blocked, /type: "REFUND_ISSUED"/);
  assert.doesNotMatch(blocked, /relatedUserId:/);
  assert.match(blocked, /BLOCKED_CHECKOUT_REFUND_ACTION/);
  assert.match(blocked, /dedupKey: `refund-issued:\$\{sourceId\}`/);
  assert.match(blocked, /templateName: "refund_issued"/);
  assert.match(blocked, /preferenceKey: "EMAIL_REFUND_ISSUED"/);
  assert.equal((blocked.match(/\},\s*tx,?\s*\);/g) ?? []).length, 2);
  assert.ok(
    blocked.indexOf("processEmailOutboxJobById(committed.emailOutboxId)") >
      blocked.indexOf("const committed = await prisma.$transaction"),
    "blocked-checkout email delivery must run only after its outbox reservation commits",
  );
  assert.doesNotMatch(webhookRoute, /input\.buyerUserId/);
  assert.equal(
    (webhookRoute.match(/finalizeBlockedCheckoutOrderRefund\(\{/g) ?? [])
      .length,
    2,
  );
});

test("notification and email-outbox helpers honor the transaction client", () => {
  const notification = source("src/lib/notificationServiceAccess.ts");
  const createStart = notification.indexOf(
    "export async function createNotificationServiceRow",
  );
  const createEnd = notification.indexOf(
    "export type BackInStockNotificationClaim",
  );
  const create = notification.slice(createStart, createEnd);
  const outbox = source("src/lib/emailOutbox.ts");

  assert.match(create, /client: NotificationServiceClient = prisma/);
  assert.equal((create.match(/client\.\$queryRaw/g) ?? []).length, 10);
  assert.doesNotMatch(create, /prisma\.\$queryRaw/);
  assert.match(outbox, /client: EmailOutboxClient = prisma/);
  assert.match(outbox, /client\.emailOutbox\.createMany/);
  assert.match(outbox, /skipDuplicates: true/);
  assert.match(outbox, /client\.emailOutbox\.findUnique/);
  assert.doesNotMatch(outbox, /P2002|isUniqueError/);
  assert.match(outbox, /"refund_issued"/);
  assert.match(outbox, /export async function processEmailOutboxJobById/);
  assert.match(outbox, /idempotencyKey: job\.dedupKey/);
});

test("refund email is rendered for deterministic outbox delivery", () => {
  const email = source("src/lib/email.ts");

  assert.match(email, /export function renderRefundIssuedEmail/);
  assert.match(
    email,
    /export async function sendRefundIssued\(\s*opts: Parameters<typeof renderRefundIssuedEmail>\[0\],?\s*\)/,
  );
  assert.match(email, /const rendered = renderRefundIssuedEmail\(opts\)/);
});

test("the audit and durable rollout records retain the crash-gap decision", () => {
  const audit = source("docs/order-payment-event-pre-rls-audit.md");
  const record = source("docs/order-payment-event-refund-record-authority.md");
  const strategy = source("STRATEGY.md");

  assert.match(
    audit,
    /OPE-A11 - refund participant delivery had a post-commit crash gap/,
  );
  assert.match(
    audit,
    /fixed record operation,\s*source-validated Notification function and deterministic refund EmailOutbox\s*reservation through one Prisma database transaction/,
  );
  assert.match(record, /Crash-safe participant delivery refinement/);
  assert.match(
    strategy,
    /post-commit crash gap in refund\s*participant notification\/email delivery/,
  );
});

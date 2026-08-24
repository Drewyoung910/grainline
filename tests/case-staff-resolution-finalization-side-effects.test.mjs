import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "src/app/api/cases/[id]/resolve/route.ts",
  "utf8",
);
const finalization = readFileSync(
  "src/lib/caseStaffResolutionFinalization.ts",
  "utf8",
);
const email = readFileSync("src/lib/email.ts", "utf8");
const outbox = readFileSync("src/lib/emailOutbox.ts", "utf8");
const design = readFileSync(
  "docs/order-payment-event-case-refund-delivery.md",
  "utf8",
);

test("Case staff finalization co-commits participant delivery records", () => {
  const transactionStart = finalization.indexOf(
    "prisma.$transaction(async (tx) =>",
  );
  const databaseFinalize = finalization.indexOf(
    "await finalizeCaseStaffResolution(",
    transactionStart,
  );
  const buyerNotification = finalization.indexOf(
    "await createNotificationOrThrow({",
    databaseFinalize,
  );
  const sellerNotification = finalization.indexOf(
    "await createNotificationOrThrow({",
    buyerNotification + 1,
  );
  const emailReservation = finalization.indexOf(
    "await enqueueEmailOutboxOnce(",
    sellerNotification,
  );
  const transactionEnd = finalization.indexOf("});", emailReservation);
  const directDelivery = finalization.indexOf(
    "await processEmailOutboxJobById(",
    transactionEnd,
  );

  assert.ok(transactionStart >= 0);
  assert.ok(databaseFinalize > transactionStart);
  assert.ok(buyerNotification > databaseFinalize);
  assert.ok(sellerNotification > buyerNotification);
  assert.ok(emailReservation > sellerNotification);
  assert.ok(transactionEnd > emailReservation);
  assert.ok(directDelivery > transactionEnd);
  assert.match(
    finalization,
    /finalizeCaseStaffResolution\([\s\S]*actorUserId,[\s\S]*prepared,[\s\S]*tx,/,
  );
  assert.match(
    finalization,
    /dedupKey: `case-resolution:\$\{result\.claimId\}`/,
  );
  assert.match(finalization, /preferenceKey: refunding[\s\S]*"EMAIL_REFUND_ISSUED"[\s\S]*"EMAIL_CASE_RESOLVED"/);
  assert.match(finalization, /sourceId: result\.claimId/);
});

test("Case route has no post-finalization best-effort delivery gap", () => {
  assert.match(route, /finalizeCaseStaffResolutionWithSideEffects\(/);
  assert.doesNotMatch(route, /await createNotification\(/);
  assert.doesNotMatch(route, /await sendCaseResolved\(/);
  assert.doesNotMatch(route, /await shouldSendEmail\(/);
  assert.doesNotMatch(route, /prisma\.user\.findUnique/);
});

test("Case resolution email uses the versioned retryable outbox", () => {
  assert.match(email, /export function renderCaseResolvedEmail\(/);
  assert.match(
    email,
    /export async function sendCaseResolved\([\s\S]*sendRenderedEmail\(renderCaseResolvedEmail\(opts\)\)/,
  );
  assert.match(outbox, /"case_resolved"/);
  assert.match(finalization, /templateName: "case_resolved"/);
  assert.match(finalization, /processEmailOutboxJobById/);
  assert.match(
    finalization,
    /Committed Case-resolution email outbox row is missing/,
  );
});

test("durable records keep the staff Case boundary and remaining gates explicit", () => {
  assert.match(
    design,
    /compatible application candidate merged through exact main/,
  );
  assert.match(design, /does\s+not add or replace a\s+database function/);
  assert.match(design, /Stripe remains outside this transaction/);
  assert.match(design, /same\s+claim\/provider evidence may retry/);
  assert.match(design, /not `OrderPaymentEvent` RLS\s+activation evidence/);
  assert.match(design, /fresh aggregate-only production data classification/);
  assert.match(design, /policyless `ENABLE`/);
  assert.match(design, /separate `FORCE`/);
});

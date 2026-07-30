import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const PROOFS_WITH_DIRECT_CASE_FIXTURES = Object.freeze([
  "scripts/case-reply-authority-postgres-proof.mjs",
  "scripts/case-message-preflight-authority-postgres-proof.mjs",
  "scripts/case-message-page-authority-postgres-proof.mjs",
  "scripts/case-recipient-read-authority-postgres-proof.mjs",
  "scripts/case-staff-queue-authority-postgres-proof.mjs",
  "scripts/case-order-active-authority-postgres-proof.mjs",
  "scripts/case-seller-aggregate-authority-postgres-proof.mjs",
  "scripts/case-account-export-authority-postgres-proof.mjs",
  "scripts/case-escalation-cron-authority-postgres-proof.mjs",
  "scripts/case-account-deletion-authority-postgres-proof.mjs",
  "scripts/notification-rls-ephemeral-proof.mjs",
  "scripts/direct-upload-activation-postgres-proof.mjs",
  "scripts/direct-upload-authority-postgres-proof.mjs",
]);

test("post-migration Case proof fixtures preserve durable opening and seller evidence", () => {
  for (const path of PROOFS_WITH_DIRECT_CASE_FIXTURES) {
    const source = fs.readFileSync(path, "utf8");
    assert.match(
      source,
      /async function seedFixtures\((?:client|owner)\) \{[\s\S]{0,220}(?:client|owner)\.query\("BEGIN"\)/,
      `${path} must seed its deferred Case evidence atomically`,
    );
    assert.match(
      source,
      /INSERT INTO public\."OrderItem"/,
      `${path} must seed the exact Order seller relationship`,
    );
    assert.match(
      source,
      /INSERT INTO public\."CaseMessage"/,
      `${path} must seed durable human opening evidence`,
    );
  }
});

test("post-migration Case-message page proof cannot recreate retired null author kinds", () => {
  const source = fs.readFileSync(
    "scripts/case-message-page-authority-postgres-proof.mjs",
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /"authorKind", body, "createdAt"\s*\)\s*VALUES\s*\(\s*\$1, \$2, \$3, NULL/,
  );
  assert.match(source, /proveCanonicalAuthorKindProjection/);
});

test("post-migration Case-reply fixtures order lifecycle clocks consistently", () => {
  const source = fs.readFileSync(
    "scripts/case-reply-authority-postgres-proof.mjs",
    "utf8",
  );
  const seedCase = source.match(
    /async function seedCase\([\s\S]+?\n}\n\nfunction uploadKey/,
  )?.[0];
  assert.ok(seedCase, "Case-reply seedCase function is missing");
  assert.match(
    seedCase,
    /CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP/,
  );
  assert.match(
    seedCase,
    /CURRENT_TIMESTAMP - INTERVAL '1 hour'/,
  );
  assert.equal(
    [...source.matchAll(/AND id <> \$[23]/g)].length,
    3,
    "Case-reply side-effect counts must exclude durable opening evidence",
  );
  assert.match(source, /function openingMessageId\(caseId\)/);
});

test("post-migration seller aggregate fixtures cannot regress updatedAt behind a JavaScript clock", () => {
  const source = fs.readFileSync(
    "scripts/case-seller-aggregate-authority-postgres-proof.mjs",
    "utf8",
  );
  const seedCase = source.match(
    /async function seedCase\([\s\S]+?\n}\n\nasync function seedFixtures/,
  )?.[0];
  assert.ok(seedCase, "Case seller-aggregate seedCase function is missing");
  assert.match(
    seedCase,
    /GREATEST\(CURRENT_TIMESTAMP, \$6::timestamp\)/,
  );
});

test("Case lifecycle reset fixtures create valid opening and refund evidence", () => {
  const source = fs.readFileSync(
    "scripts/case-lifecycle-postgres-proof.mjs",
    "utf8",
  );
  const resetCase = source.match(
    /async function resetCase\([\s\S]+?\n}\n\nasync function waitForLock/,
  )?.[0];
  assert.ok(resetCase, "Case lifecycle resetCase function is missing");
  assert.match(resetCase, /client\.\$transaction\(async \(tx\) =>/);
  assert.match(resetCase, /await tx\.case\.create/);
  assert.match(resetCase, /await tx\.caseMessage\.create/);
  assert.match(resetCase, /authorKind: "BUYER"/);
  assert.match(resetCase, /const fixtureCreatedAt = new Date/);
  assert.match(resetCase, /sellerRespondBy\.getTime\(\) - 60_000/);
  assert.match(
    resetCase,
    /discussionStartedAt\.getTime\(\) - 60_000/,
  );
  assert.match(resetCase, /createdAt: fixtureCreatedAt/);
  const attemptCaseCreate = source.match(
    /async function attemptCaseCreate\([\s\S]+?\n}\n\nasync function attemptLabelReservation/,
  )?.[0];
  assert.ok(
    attemptCaseCreate,
    "Case lifecycle attemptCaseCreate function is missing",
  );
  assert.match(attemptCaseCreate, /await tx\.case\.create/);
  assert.match(attemptCaseCreate, /await tx\.caseMessage\.create/);
  assert.doesNotMatch(
    attemptCaseCreate,
    /caseMessage\.create\([\s\S]+?createdAt:\s*now/,
    "opening message must not reuse the pre-Case clock",
  );
  assert.match(source, /refundAmountCents: 10_000/);
  assert.match(source, /stripeRefundId: "case-lifecycle-proof-refund"/);
  const attemptBuyerMarkResolved = source.match(
    /async function attemptBuyerMarkResolved\([\s\S]+?\n}\n\nasync function attemptCronEscalation/,
  )?.[0];
  assert.ok(
    attemptBuyerMarkResolved,
    "Case lifecycle participant-resolution helper is missing",
  );
  assert.match(
    attemptBuyerMarkResolved,
    /WHEN "sellerMarkedResolved"[\s\S]+?'RESOLVED'::"CaseStatus"/,
  );
  assert.match(attemptBuyerMarkResolved, /'DISMISSED'::"CaseResolution"/);
  assert.match(attemptBuyerMarkResolved, /"resolvedAt" = CASE/);
  assert.match(
    attemptBuyerMarkResolved,
    /CAST\(\$\{transitionAt\} AS timestamp without time zone\)/,
  );
  assert.match(attemptBuyerMarkResolved, /"resolvedById" = CASE/);
  assert.doesNotMatch(
    source,
    /caseMessage\.deleteMany/,
    "Case cleanup must delete the parent and let ON DELETE CASCADE remove messages",
  );
});

test("Notification resolution fixtures keep refund provider evidence complete", () => {
  const source = fs.readFileSync(
    "scripts/notification-rls-ephemeral-proof.mjs",
    "utf8",
  );
  const configureResolvedCase = source.match(
    /async function configureResolvedCase\([\s\S]+?\n}\n\nasync function configureCaseResolutionAudit/,
  )?.[0];
  assert.ok(
    configureResolvedCase,
    "Notification configureResolvedCase helper is missing",
  );
  assert.match(configureResolvedCase, /resolution === "REFUND_FULL" \? 12_500/);
  assert.match(configureResolvedCase, /"stripeRefundId" = \$4/);
  assert.match(configureResolvedCase, /re_notification_proof_/);
  assert.match(source, /caseSellerMessageId:/);
  assert.match(source, /caseStaffMessageId:/);
  assert.doesNotMatch(
    source,
    /UPDATE public\."CaseMessage"/,
    "Notification proof must not rewrite immutable CaseMessage authority",
  );
});

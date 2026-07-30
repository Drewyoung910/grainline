import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const route = readFileSync(
  "src/app/api/cases/[id]/resolve/route.ts",
  "utf8",
);
const authority = readFileSync(
  "src/lib/caseStaffResolutionAuthority.ts",
  "utf8",
);
const migration = readFileSync(
  "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
  "utf8",
);
const normalizedMigration = migration.replace(/\s+/g, " ");

function assertOrdered(source, markers) {
  let prior = -1;
  for (const [label, marker] of markers) {
    const current = source.indexOf(marker);
    assert.ok(current >= 0, `${label} marker is absent`);
    assert.ok(current > prior, `${label} is out of order`);
    prior = current;
  }
}

describe("Case staff-resolution application authority", () => {
  it("keeps the PIN-gated route on the fixed prepare-provider-finalize protocol", () => {
    assertOrdered(route, [
      ["origin guard", "getExplicitCrossOriginPostRejection(req)"],
      ["authentication", "await auth()"],
      ["staff role check", 'me.role !== "EMPLOYEE"'],
      ["staff PIN", "await requireStaffAdminPinForApi("],
      ["rate limit", "await safeRateLimit("],
      ["bounded body", "await readBoundedJson("],
      ["database prepare", "await prepareCaseStaffResolution("],
      ["Stripe call", "await createMarketplaceRefund("],
      ["provider record", "await recordCaseStaffResolutionProvider("],
      ["database finalize", "await finalizeCaseStaffResolution("],
      ["notification side effects", "await createNotification("],
    ]);
    assert.match(
      route,
      /catch \(stripeError\)[\s\S]*await recordAmbiguousCaseStaffResolutionProvider\([\s\S]*throw stripeError/,
    );
    assert.match(
      route,
      /prepared\.status === "PROVIDER_PENDING"[\s\S]*createMarketplaceRefund/,
    );
    assert.match(
      route,
      /prepared\.status === "RECONCILIATION_REQUIRED"[\s\S]*administrator must reconcile/,
    );
  });

  it("lets the locked database protocol decide fresh work and exact replay", () => {
    assert.doesNotMatch(route, /prisma\.case\./);
    assert.doesNotMatch(route, /blockingRefundLedgerWhere/);
    assert.doesNotMatch(route, /sellerRefundConflictResponse/);
    assert.doesNotMatch(route, /orderHasRefundLedger/);
    assert.doesNotMatch(route, /orderHasPurchasedLabel/);
    assert.match(
      normalizedMigration,
      /IF locked_order\."caseResolutionClaimId" IS NOT NULL THEN[\s\S]*existing_claim\."caseId" IS DISTINCT FROM locked_case\.id[\s\S]*existing_claim\."staffActorId" IS DISTINCT FROM locked_actor\.id[\s\S]*existing_claim\.resolution IS DISTINCT FROM p_resolution[\s\S]*RETURN pg_catalog\.jsonb_build_object/,
    );
    assert.ok(
      normalizedMigration.indexOf(
        'IF locked_order."caseResolutionClaimId" IS NOT NULL THEN',
      )
        < normalizedMigration.indexOf(
          'Case staff-resolution Order has refund activity',
        ),
      "an exact durable claim must replay before new-work refund guards",
    );
  });

  it("uses only database-derived refund authority and final identities", () => {
    assert.match(
      route,
      /paymentIntentId: prepared\.paymentIntentId!/,
    );
    assert.match(route, /amountCents: prepared\.refundAmountCents!/);
    assert.match(route, /canReverseTransfer: prepared\.canReverseTransfer/);
    assert.match(route, /idempotencyKeyBase: prepared\.idempotencyScope!/);
    assert.match(route, /reason: "requested_by_customer"/);
    assert.match(
      route,
      /stockRestoreDecision:[\s\S]*resolution === "REFUND_PARTIAL"\s*\?\s*requestedStockRestores\s*:\s*\[\]/,
    );
    assert.match(route, /userId: finalized\.buyerUserId/);
    assert.match(route, /userId: finalized\.sellerUserId/);
    assert.match(route, /sourceId: finalized\.resolutionMessageId/);
    assert.match(
      route,
      /return privateJson\(\{\s*ok: true,\s*caseId: finalized\.caseId,\s*orderId: finalized\.orderId,\s*resolution: finalized\.resolution,\s*\}\)/,
    );

    assert.doesNotMatch(route, /updatedCase/);
    assert.doesNotMatch(route, /include: \{ messages: true, order: true \}/);
    assert.doesNotMatch(route, /refundIdempotencyKeyBase/);
    assert.doesNotMatch(route, /REFUND_LOCK_SENTINEL/);
    assert.doesNotMatch(route, /REFUND_AMBIGUOUS_SENTINEL/);
    assert.doesNotMatch(route, /recordLocalRefundEvidence/);
    assert.doesNotMatch(route, /logAdminActionOrThrow/);
    assert.doesNotMatch(route, /(?:prisma|tx)\.case\.(?:create|update|updateMany)/);
    assert.doesNotMatch(route, /(?:prisma|tx)\.caseMessage\.create/);
    assert.doesNotMatch(route, /prisma\.\$transaction/);
  });

  it("calls exact fixed functions and rejects malformed database results", () => {
    for (const functionName of [
      "grainline_case_staff_resolution_prepare",
      "grainline_case_staff_resolution_provider_record",
      "grainline_case_staff_resolution_finalize",
    ]) {
      assert.match(
        authority,
        new RegExp(`SELECT public\\.${functionName}\\(`),
      );
    }
    assert.match(authority, /if \(rows\.length !== 1\)/);
    assert.match(authority, /Case staff-resolution prepare identity drifted/);
    assert.match(authority, /Case staff-resolution provider claim drifted/);
    assert.match(authority, /Case staff-resolution provider identity drifted/);
    assert.match(
      authority,
      /Case staff-resolution finalization identity drifted/,
    );
    assert.match(
      authority,
      /idempotencyScope\s*!== `case-resolve:\$\{claimId\}:\$\{resolution\}:\$\{refundAmountCents\}`/,
    );
    assert.match(
      authority,
      /resolutionMessageId\s*!== `case_resolution_message_\$\{prepared\.claimId\}`/,
    );
  });

  it("rejects empty, duplicated, mismatched, or incomplete provider evidence", () => {
    assert.match(authority, /evidence\.refundIds\.length < 1/);
    assert.match(authority, /evidence\.refundIds\.length > 5/);
    assert.match(
      authority,
      /evidence\.refundStatuses\.length !== evidence\.refundIds\.length/,
    );
    assert.match(authority, /new Set\(refundIds\)\.size !== refundIds\.length/);
    assert.match(authority, /!refundIds\.includes\(primaryRefundId\)/);
    assert.match(
      authority,
      /transferReversalId === null[\s\S]*transferReversalAmountCents !== null/,
    );
    assert.ok(
      authority.indexOf("validateProviderEvidence(evidence)")
        < authority.indexOf("Prisma.join("),
      "provider evidence must validate before SQL-array construction",
    );
  });

  it("keeps payment evidence, Case history, stock, and audit atomic in PostgreSQL", () => {
    assert.match(
      normalizedMigration,
      /INSERT INTO public\."OrderPaymentEvent"/,
    );
    assert.match(normalizedMigration, /UPDATE public\."Case" AS case_row/);
    assert.match(
      normalizedMigration,
      /INSERT INTO public\."CaseMessage"/,
    );
    assert.match(
      normalizedMigration,
      /INSERT INTO public\."AdminAuditLog"/,
    );
    assert.match(
      normalizedMigration,
      /UPDATE public\."Listing" AS listing/,
    );
    assert.match(
      normalizedMigration,
      /message_id := 'case_resolution_message_' \|\| locked_claim\.id/,
    );
    assert.match(
      normalizedMigration,
      /status = 'FINALIZED'::public\."CaseResolutionClaimStatus"/,
    );
    assert.match(
      normalizedMigration,
      /SET "caseResolutionClaimId" = NULL/,
    );
  });
});

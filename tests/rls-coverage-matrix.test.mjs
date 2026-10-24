import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
const matrix = fs.readFileSync("docs/rls-coverage-matrix.md", "utf8");
const architecture = fs.readFileSync("docs/architecture.md", "utf8");

function schemaModels() {
  return [...schema.matchAll(/^model\s+([A-Za-z][A-Za-z0-9_]*)\s+\{/gm)]
    .map((match) => match[1])
    .sort();
}

function matrixRows() {
  return [...matrix.matchAll(
    /^\| `([A-Za-z][A-Za-z0-9_]*)` \| `([A-Z_]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm,
  )].map((match) => ({
    model: match[1],
    status: match[2],
    group: match[3].trim(),
    actors: match[4].trim(),
    nextProof: match[5].trim(),
  }));
}

describe("site-wide RLS coverage matrix", () => {
  it("contains every Prisma model exactly once", () => {
    const models = schemaModels();
    const rows = matrixRows();
    const documentedModels = rows.map((row) => row.model).sort();

    assert.equal(models.length, 70, "review the snapshot count when the schema changes");
    assert.match(matrix, /Candidate-source snapshot scope: 70 Prisma models\./);
    assert.equal(rows.length, models.length, "matrix must have exactly one row per model");
    assert.deepEqual(documentedModels, models);
    assert.equal(new Set(documentedModels).size, documentedModels.length);
  });

  it("uses only explicit incomplete or evidenced disposition states", () => {
    const allowed = new Set([
      "RLS_LIVE_PHASE_A",
      "RLS_LIVE_PHASE_A_FORCE_PREPARED",
      "RLS_LIVE_PHASE_A_PENDING_POSTFLIGHT",
      "RLS_LIVE_PHASE_B",
      "RLS_LIVE_FORCE",
      "RLS_LIVE_ENABLE",
      "RLS_LIVE_FORCE_PENDING_POSTFLIGHT",
      "RLS_LIVE_ENABLE_FORCE_CANDIDATE",
      "PLANNED_RLS",
      "COMPATIBLE_CANDIDATE",
      "ACTIVATION_CANDIDATE",
      "COMPATIBLE_PREPARATION_LIVE",
      "ACTIVATION_RELEASE_ISOLATED",
      "ACTIVATION_RELEASE_MERGED_UNAPPLIED",
      "ACTIVATION_PRODUCTION_WIRING_ISOLATED",
      "BLOCKED_DESIGN",
      "ALTERNATIVE_REVIEW",
    ]);
    const rows = matrixRows();

    for (const row of rows) {
      assert.ok(allowed.has(row.status), `${row.model} has unknown status ${row.status}`);
      assert.ok(row.group.length > 0, `${row.model} needs an activation owner or group`);
      assert.ok(row.actors.length > 0, `${row.model} needs a data and actor summary`);
      assert.ok(row.nextProof.length > 0, `${row.model} needs a blocking prerequisite or next proof`);
    }
  });

  it("does not overstate current production RLS coverage", () => {
    const liveRows = matrixRows().filter((row) => row.status.startsWith("RLS_LIVE"));
    assert.deepEqual(liveRows.map((row) => row.model), [
      "User",
      "UserEmailAddress",
      "SellerProfile",
      "SellerProfilePrivate",
      "Conversation",
      "Message",
      "Order",
      "OrderShippingRateQuote",
      "OrderDisputeRecovery",
      "OrderPaymentEvent",
      "OrderRefundReconciliation",
      "OrderStaffCapability",
      "SellerPayoutEvent",
      "SellerDeauthorizationApplication",
      "OrderItem",
      "CheckoutStockReservation",
      "Case",
      "CaseResolutionClaim",
      "CaseStripeDisputeApplication",
      "CaseSellerRefundApplication",
      "CaseOpenApplication",
      "CaseMessage",
      "CaseMessageAttachment",
      "SavedSearch",
      "ClerkWebhookEvent",
      "DirectUpload",
      "DirectUploadReference",
      "AccountDeletionSideEffect",
      "SupportRequest",
      "StripeWebhookEvent",
      "Notification",
    ]);
    assert.deepEqual(
      liveRows.map((row) => [row.model, row.status]),
      [
        ["User", "RLS_LIVE_FORCE"],
        ["UserEmailAddress", "RLS_LIVE_FORCE"],
        ["SellerProfile", "RLS_LIVE_FORCE"],
        ["SellerProfilePrivate", "RLS_LIVE_FORCE"],
        ["Conversation", "RLS_LIVE_FORCE"],
        ["Message", "RLS_LIVE_FORCE"],
        ["Order", "RLS_LIVE_FORCE"],
        ["OrderShippingRateQuote", "RLS_LIVE_FORCE"],
        ["OrderDisputeRecovery", "RLS_LIVE_FORCE"],
        ["OrderPaymentEvent", "RLS_LIVE_FORCE"],
        [
          "OrderRefundReconciliation",
          "RLS_LIVE_FORCE",
        ],
        ["OrderStaffCapability", "RLS_LIVE_FORCE"],
        ["SellerPayoutEvent", "RLS_LIVE_FORCE"],
        ["SellerDeauthorizationApplication", "RLS_LIVE_FORCE"],
        ["OrderItem", "RLS_LIVE_FORCE"],
        ["CheckoutStockReservation", "RLS_LIVE_FORCE"],
        ["Case", "RLS_LIVE_FORCE"],
        ["CaseResolutionClaim", "RLS_LIVE_FORCE"],
        ["CaseStripeDisputeApplication", "RLS_LIVE_FORCE"],
        ["CaseSellerRefundApplication", "RLS_LIVE_FORCE"],
        ["CaseOpenApplication", "RLS_LIVE_FORCE"],
        ["CaseMessage", "RLS_LIVE_FORCE"],
        ["CaseMessageAttachment", "RLS_LIVE_FORCE"],
        ["SavedSearch", "RLS_LIVE_PHASE_B"],
        ["ClerkWebhookEvent", "RLS_LIVE_FORCE"],
        ["DirectUpload", "RLS_LIVE_FORCE"],
        ["DirectUploadReference", "RLS_LIVE_FORCE"],
        ["AccountDeletionSideEffect", "RLS_LIVE_FORCE"],
        ["SupportRequest", "RLS_LIVE_ENABLE"],
        ["StripeWebhookEvent", "RLS_LIVE_FORCE"],
        ["Notification", "RLS_LIVE_PHASE_B"],
      ],
    );
    assert.match(
      matrix,
      /Current candidate source contains 70 Prisma models\.[\s\S]*thirty[\s\S]*Production FORCE evidence[\s\S]*one with policyless Production\s+ENABLE\/NO FORCE[\s\S]*thirty-nine without a live RLS activation/,
    );
    assert.match(
      matrix,
      /OrderRefundReconciliation` closed its distinct actual pooled-runtime proof[\s\S]*ecb1ce1b1f4dd6fa2ad62e23882c16f6021be6ed42698b54a663ca11bd236f10/,
    );
    assert.match(
      matrix,
      /Pooled-runtime and cleanup-role acceptance passed read-only/,
    );
    assert.match(
      matrix,
      /User` is[\s\S]*policyless and FORCE-hardened[\s\S]*37747980060[\s\S]*85934f600f46c3e4b08046888d008970eaf8f171[\s\S]*37763700848[\s\S]*37766247341[\s\S]*UserEmailAddress` closed its policyless FORCE release[\s\S]*37133944427[\s\S]*37136042748[\s\S]*OrderPaymentEvent` closed its posture-only FORCE release[\s\S]*33445073482[\s\S]*d63cea7bd6a95232790aef4ecd4b279ae837bada1bad7cb80ef6aa604671eea1/,
    );
    assert.match(
      matrix,
      /UserEmailAddress`[\s\S]*e689e1ff1d76a65146d132ad25dc545a72b87aac[\s\S]*37133944427[\s\S]*37136042748/,
    );
    assert.match(matrix, /Application authorization alone is not that\s+alternative\./);
    assert.match(matrix, /migration run `30953378226`/);
    assert.match(
      architecture,
      /All thirty tables have[\s\S]*complete retained `FORCE ROW LEVEL SECURITY` acceptance[\s\S]*User` is policyless[\s\S]*37747980060[\s\S]*85934f600f46c3e4b08046888d008970eaf8f171[\s\S]*37763700848[\s\S]*37766247341[\s\S]*37136042748[\s\S]*33445073482[\s\S]*d63cea7bd6a95232790aef4ecd4b279ae837bada1bad7cb80ef6aa604671eea1/,
    );
    assert.match(architecture, /`SellerPayoutEvent` FORCE was[\s\S]*distinct actual pooled-runtime FORCE postflight passed/);
    assert.match(
      architecture,
      /CheckoutStockReservation` is a completed service-ledger boundary/,
    );
    assert.match(architecture, /SupportRequest is the active private-table candidate/);
    assert.doesNotMatch(architecture, /Case-family RLS is still off/);
  });

  it("keeps future saved-search alerts outside the sealed Phase B contract", () => {
    assert.match(matrix, /Future Saved-Search Match Alerts/);
    assert.match(matrix, /notifyEmail Boolean @default\(true\)/);
    assert.match(matrix, /no `UPDATE` on `SavedSearch`/);
    assert.match(matrix, /durable unique delivery ledger keyed by saved search and listing/);
    assert.match(matrix, /after Bucket B establishes the Notification\s+service-write model/);
    assert.match(matrix, /should not delay the already sealed SavedSearch Phase B/);
  });
});

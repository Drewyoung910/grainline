import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  CASE_AUTHORITY_OPERATION_IDS,
  CASE_AUTHORITY_OPERATIONS,
  CASE_AUTHORITY_SOURCE_DESTINATIONS,
  CASE_CONVERTED_SOURCE_DESTINATIONS,
  caseAuthorityConvertedReferenceCount,
  caseAuthorityReferenceCount,
} from "../scripts/case-case-message-authority-catalog.mjs";
import {
  collectCaseCaseMessageAccess,
  summarizeCaseCaseMessageAccess,
} from "../scripts/case-case-message-rls-inventory.mjs";

describe("Case, CaseMessage, and attachment authority catalog", () => {
  const inventory = collectCaseCaseMessageAccess();
  const summary = summarizeCaseCaseMessageAccess(inventory);

  it("classifies all 12 remaining references and retains the 68 converted references", () => {
    assert.equal(caseAuthorityReferenceCount(), 12);
    assert.equal(caseAuthorityConvertedReferenceCount(), 68);
    assert.equal(
      caseAuthorityReferenceCount() + caseAuthorityConvertedReferenceCount(),
      80,
    );
    assert.equal(Object.keys(CASE_AUTHORITY_SOURCE_DESTINATIONS).length, 2);
    assert.deepEqual(
      Object.keys(CASE_AUTHORITY_SOURCE_DESTINATIONS).sort(),
      Object.keys(summary).sort(),
    );
    for (const [source, classification] of Object.entries(
      CASE_AUTHORITY_SOURCE_DESTINATIONS,
    )) {
      assert.deepEqual(
        classification.inventory,
        summary[source],
        `${source} inventory drifted`,
      );
      assert.ok(classification.actors.length > 0, `${source} has no actor`);
      assert.ok(
        classification.destinations.length > 0,
        `${source} has no authority destination`,
      );
    }
    for (const [source, classification] of Object.entries(
      CASE_CONVERTED_SOURCE_DESTINATIONS,
    )) {
      assert.ok(classification.actors.length > 0, `${source} has no actor`);
      assert.ok(
        classification.destinations.length > 0,
        `${source} has no converted authority destination`,
      );
    }
  });

  it("uses one unique, fully referenced operation catalog", () => {
    assert.equal(
      new Set(CASE_AUTHORITY_OPERATION_IDS).size,
      CASE_AUTHORITY_OPERATION_IDS.length,
    );
    assert.equal(CASE_AUTHORITY_OPERATIONS.length, 28);
    const referenced = new Set(
      Object.values(CASE_AUTHORITY_SOURCE_DESTINATIONS)
        .concat(Object.values(CASE_CONVERTED_SOURCE_DESTINATIONS))
        .flatMap((source) => source.destinations),
    );
    assert.deepEqual(
      [...referenced].sort(),
      [...CASE_AUTHORITY_OPERATION_IDS].sort(),
    );
    for (const destination of referenced) {
      assert.ok(
        CASE_AUTHORITY_OPERATION_IDS.includes(destination),
        `unknown authority destination ${destination}`,
      );
    }
  });

  it("keeps ordinary recipient reads invoker-scoped and source-bound exceptions narrow", () => {
    const byId = new Map(
      CASE_AUTHORITY_OPERATIONS.map((operation) => [
        operation.id,
        operation,
      ]),
    );
    for (const id of [
      "case_get",
      "case_get_by_order",
      "case_staff_active_count",
      "case_export",
    ]) {
      assert.equal(byId.get(id)?.security, "INVOKER", id);
    }
    assert.equal(byId.get("case_message_preflight")?.security, "DEFINER");
    assert.equal(byId.get("case_message_page")?.security, "DEFINER");
    assert.equal(byId.get("case_staff_queue")?.security, "DEFINER");
    assert.equal(byId.get("case_order_active_buyer")?.security, "DEFINER");
    assert.equal(byId.get("case_order_active_seller")?.security, "DEFINER");
    assert.equal(
      byId.get("case_order_pii_retention_prune")?.operationKind,
      "LIFECYCLE_WRITE",
    );
    assert.equal(
      byId.get("case_message_preflight")?.operationKind,
      "SOURCE_BOUND_READ",
    );
    assert.equal(
      byId.get("case_staff_queue")?.operationKind,
      "SOURCE_BOUND_READ",
    );
    for (const operation of CASE_AUTHORITY_OPERATIONS) {
      assert.ok(operation.candidateFunctionName.startsWith("grainline_"));
      assert.ok(operation.callerInputs.length > 0);
      assert.ok(operation.databaseDerived.length > 0);
      assert.ok(Array.isArray(operation.applicationPreconditions));
      assert.ok(Array.isArray(operation.externalTrustBoundaries));
      assert.doesNotMatch(
        operation.callerInputs.join(" "),
        /pin|verified|authorization|providerResult/i,
        operation.id,
      );
      if (
        operation.operationKind === "WRITE_SERVICE"
        || operation.operationKind === "LIFECYCLE_WRITE"
      ) {
        assert.equal(operation.security, "DEFINER", operation.id);
        assert.equal(operation.runtimeExecute, true, operation.id);
      }
    }
    assert.equal(byId.get("case_lock_core")?.runtimeExecute, false);
  });

  it("does not leave security-relevant Case writes as caller-selected state", () => {
    const writes = CASE_AUTHORITY_OPERATIONS.filter((operation) =>
      new Set(["WRITE_SERVICE", "LIFECYCLE_WRITE"]).has(
        operation.operationKind,
      ),
    );
    assert.ok(writes.length >= 10);
    for (const operation of writes) {
      const derived = operation.databaseDerived.join(" ");
      assert.match(
        derived,
        /locked|target|Case|Order|participant|claim/i,
        operation.id,
      );
    }
    const open = CASE_AUTHORITY_OPERATIONS.find(
      (operation) => operation.id === "case_open",
    );
    assert.match(
      open.databaseDerived.join(" "),
      /database-generated Case, opening message and audit identities/,
    );
    const reply = CASE_AUTHORITY_OPERATIONS.find(
      (operation) => operation.id === "case_reply",
    );
    assert.match(reply.databaseDerived.join(" "), /author kind/);
    assert.match(reply.databaseDerived.join(" "), /attachment ownership/);
    assert.match(reply.applicationPreconditions.join(" "), /staff PIN/);
    const finalize = CASE_AUTHORITY_OPERATIONS.find(
      (operation) => operation.id === "case_staff_resolution_finalize",
    );
    assert.deepEqual(finalize.callerInputs, [
      "actorUserId",
      "resolutionClaimId",
    ]);
    assert.match(
      finalize.databaseDerived.join(" "),
      /exact claim-linked durable local OrderPaymentEvent/,
    );
    assert.match(
      finalize.externalTrustBoundaries.join(" "),
      /does not independently attest Stripe/,
    );
    const providerRecord = CASE_AUTHORITY_OPERATIONS.find(
      (operation) =>
        operation.id === "case_staff_resolution_provider_record",
    );
    assert.match(
      providerRecord.databaseDerived.join(" "),
      /CaseResolutionClaim/,
    );
    assert.deepEqual(providerRecord.callerInputs.slice(0, 2), [
      "actorUserId",
      "resolutionClaimId",
    ]);
    assert.ok(providerRecord.callerInputs.includes("providerOutcome"));
    assert.match(
      providerRecord.databaseDerived.join(" "),
      /RECORDED.*PROVIDER_RECORDED/,
    );
    assert.match(
      providerRecord.databaseDerived.join(" "),
      /AMBIGUOUS.*RECONCILIATION_REQUIRED/,
    );
    assert.match(
      providerRecord.databaseDerived.join(" "),
      /forbids asserted provider evidence/,
    );
    assert.doesNotMatch(
      providerRecord.callerInputs.join(" "),
      /refundAmountCents|caseId|orderId|staffResolution|stock/i,
    );
    const reconcile = CASE_AUTHORITY_OPERATIONS.find(
      (operation) =>
        operation.id === "case_staff_resolution_reconcile",
    );
    assert.match(
      reconcile.databaseDerived.join(" "),
      /ADMIN/,
    );
    assert.match(
      reconcile.databaseDerived.join(" "),
      /CONFIRMED_NO_PROVIDER_EFFECT/,
    );
    assert.match(
      reconcile.databaseDerived.join(" "),
      /RELEASED_NO_PROVIDER_EFFECT/,
    );
    assert.match(
      reconcile.externalTrustBoundaries.join(" "),
      /PostgreSQL cannot attest/,
    );
    const dispute = CASE_AUTHORITY_OPERATIONS.find(
      (operation) => operation.id === "case_stripe_dispute_apply",
    );
    assert.match(
      dispute.databaseDerived.join(" "),
      /openedByPaymentEventId/,
    );
    assert.match(
      dispute.databaseDerived.join(" "),
      /resolution and refund snapshot cleared/,
    );
    const deletion = CASE_AUTHORITY_OPERATIONS.find(
      (operation) => operation.id === "case_account_deletion_redact",
    );
    assert.deepEqual(deletion.callerInputs, ["accountDeletionSideEffectId"]);
    assert.match(deletion.databaseDerived.join(" "), /account sensitive values/);
  });

  it("selects and transitions cron rows inside one bounded database operation", () => {
    const cron = CASE_AUTHORITY_OPERATIONS.filter((operation) =>
      operation.id.startsWith("case_cron_")
    );
    assert.equal(cron.length, 1);
    assert.equal(cron[0].id, "case_cron_transition_batch");
    assert.deepEqual(cron[0].callerInputs, [
      "transitionFamily",
      "boundedLimit",
    ]);
    assert.match(cron[0].databaseDerived.join(" "), /FOR UPDATE SKIP LOCKED/);
    assert.match(
      cron[0].databaseDerived.join(" "),
      /per-row database-generated strict audit/,
    );
  });

  it("does not expose one arbitrary-seller dispute-quality oracle", () => {
    const byId = new Map(
      CASE_AUTHORITY_OPERATIONS.map((operation) => [
        operation.id,
        operation,
      ]),
    );
    assert.equal(byId.has("case_seller_quality"), false);
    assert.match(
      byId
        .get("case_seller_verification_eligibility")
        ?.databaseDerived.join(" ") ?? "",
      /actor is that seller or current staff/,
    );
    assert.match(
      byId.get("case_seller_active_count")?.databaseDerived.join(" ") ?? "",
      /count only/,
    );
    assert.match(
      byId.get("case_guild_unresolved_guard")?.databaseDerived.join(" ") ?? "",
      /guild or reinstatement state/,
    );
  });

  it("keeps every non-party staff read behind the application PIN boundary", () => {
    const byId = new Map(
      CASE_AUTHORITY_OPERATIONS.map((operation) => [
        operation.id,
        operation,
      ]),
    );
    for (const id of [
      "case_get",
      "case_get_by_order",
      "case_message_page",
      "case_staff_queue",
      "case_staff_active_count",
      "case_message_preflight",
      "case_attachment_read",
    ]) {
      assert.match(
        byId.get(id)?.applicationPreconditions.join(" ") ?? "",
        /staff PIN/,
        id,
      );
    }
  });

  it("durably records the three-table boundary and its external trust limits", () => {
    const catalog = fs.readFileSync(
      "docs/case-case-message-authority-catalog.md",
      "utf8",
    );
    const normalizedCatalog = catalog.replace(/\s+/g, " ");
    assert.match(
      normalizedCatalog,
      /one tightly coupled three-table visibility and write-integrity group/,
    );
    assert.match(
      normalizedCatalog,
      /80 protected references across 29 source files/,
    );
    assert.match(
      normalizedCatalog,
      /current exact inventory is therefore 12 remaining references across 2 source files/,
    );
    assert.match(
      normalizedCatalog,
      /machine-readable catalog contains 28 operations/,
    );
    assert.match(
      normalizedCatalog,
      /No database function accepts `staffPinWasVerified`/,
    );
    assert.match(
      normalizedCatalog,
      /does not independently attest Stripe/,
    );
    assert.match(
      normalizedCatalog,
      /does not accept a free `deletingUserId`/,
    );
    assert.match(
      normalizedCatalog,
      /Prisma `cuid\(\)` is a client default, not a database default/,
    );
    assert.match(
      normalizedCatalog,
      /distinct terminal `RELEASED_NO_PROVIDER_EFFECT` state/,
    );
    assert.match(
      normalizedCatalog,
      /It must not reuse `FINALIZED`/,
    );
    assert.match(
      normalizedCatalog,
      /Case\.openedByPaymentEventId/,
    );
    assert.match(
      normalizedCatalog,
      /current direct webhook clears only the first three fields/,
    );
    assert.match(
      normalizedCatalog,
      /keep invariant\/activation SQL outside `prisma\/migrations`/,
    );
    assert.match(
      normalizedCatalog,
      /compatible operation migrations remain unmerged and unapplied/,
    );
  });
});

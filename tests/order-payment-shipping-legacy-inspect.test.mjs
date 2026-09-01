import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ORDER_LABEL_REFERENCE_REDACTION_CLASSIFICATION_PROJECTION,
  ORDER_LABEL_AUTHORITY_REQUIRED_ZERO_FIELDS,
  ORDER_LABEL_STATE_CLASSIFICATION_PROJECTION,
  ORDER_LABEL_STATE_INVALID_PREDICATE,
  ORDER_PAYMENT_SHIPPING_FORCE_TABLES,
  ORDER_PAYMENT_SHIPPING_INSPECTION_TABLES,
  ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS,
  ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_CONFIRMATION,
  ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
  ORDER_PAYMENT_SHIPPING_LEGACY_PREREQUISITE_CONFIRMATION,
  ORDER_PAYMENT_EVENT_LOCAL_SOURCE_INVALID_PREDICATE,
  ORDER_PAYMENT_EVENT_PROVIDER_TIME_EXPRESSION,
  ORDER_PAYMENT_SHIPPING_PREDECESSOR_TABLES,
  RESERVATION_AUTHORITY_REQUIRED_ZERO_FIELDS,
  assertOrderPaymentShippingLegacyInspectionGitState,
  normalizeOrderPaymentShippingLegacyCounts,
  normalizeOrderPaymentShippingInspectionPosture,
  orderLabelAuthorityInspectionDecision,
  orderPaymentShippingLegacyInspectionFailureCode,
  parseOrderPaymentShippingLegacyInspectionConfig,
  reservationAuthorityInspectionDecision,
  writeOrderPaymentShippingLegacyInspectionEvidence,
} from "../scripts/order-payment-shipping-legacy-inspect.mjs";

const COMMIT = "c".repeat(40);
const DIRECT_URL =
  "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const workflow = fs.readFileSync(
  ".github/workflows/order-payment-shipping-legacy-inspection.yml",
  "utf8",
);
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

function tempDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "order-payment-shipping-inspect-"),
  );
}

function environment(directory, overrides = {}) {
  return {
    DIRECT_URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: COMMIT,
    MIGRATION_DB_ROLE: "neondb_owner",
    ORDER_PAYMENT_SHIPPING_LEGACY_INSPECT_CONFIRM:
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_CONFIRMATION,
    ORDER_PAYMENT_SHIPPING_LEGACY_INSPECT_EVIDENCE_PATH: path.join(
      directory,
      `order-payment-shipping-legacy-inspection-${COMMIT}.json`,
    ),
    ORDER_PAYMENT_SHIPPING_LEGACY_INSPECT_RELEASE_COMMIT: COMMIT,
    ORDER_PAYMENT_SHIPPING_LEGACY_PREREQUISITES_CONFIRMED:
      ORDER_PAYMENT_SHIPPING_LEGACY_PREREQUISITE_CONFIRMATION,
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256: createHash("sha256")
      .update(DIRECT_URL, "utf8")
      .digest("hex"),
    RUNNER_TEMP: directory,
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    ...overrides,
  };
}

function countRow(value = "0") {
  return Object.fromEntries(
    ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS.map((field) => [field, value]),
  );
}

function postureRows() {
  const forceTables = new Set(ORDER_PAYMENT_SHIPPING_FORCE_TABLES);
  return [...ORDER_PAYMENT_SHIPPING_INSPECTION_TABLES].sort().map((table) => {
    const forced = forceTables.has(table);
    return {
      table_name: table,
      owner_name: "neondb_owner",
      rls_enabled: forced,
      rls_forced: forced,
      policy_count: "0",
      runtime_can_select: !forced,
      runtime_can_insert: !forced,
      runtime_can_update: !forced,
      runtime_can_delete: !forced,
    };
  });
}

function postureRowsWith(tableName, changes) {
  return postureRows().map((row) =>
    row.table_name === tableName ? { ...row, ...changes } : row,
  );
}

describe("Order/payment/shipping aggregate-only legacy inspection", () => {
  it("accepts only the exact manual-main protected owner binding", () => {
    const directory = tempDirectory();
    try {
      const config = parseOrderPaymentShippingLegacyInspectionConfig(
        environment(directory),
      );
      assert.equal(config.releaseCommit, COMMIT);
      assert.equal(config.identity.username, "neondb_owner");
      assert.equal(config.identity.isPooler, false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects context, commit, confirmation, URL and evidence drift", () => {
    const cases = [
      { GITHUB_ACTIONS: "false" },
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_SHA: "d".repeat(40) },
      { ORDER_PAYMENT_SHIPPING_LEGACY_INSPECT_CONFIRM: "yes" },
      { ORDER_PAYMENT_SHIPPING_LEGACY_PREREQUISITES_CONFIRMED: "yes" },
      { PRODUCTION_MIGRATION_DIRECT_URL_SHA256: "0".repeat(64) },
      { DATABASE_URL: "present" },
      { GRANT_AUDIT_DATABASE_URL: "present" },
      {
        ORDER_PAYMENT_SHIPPING_LEGACY_INSPECT_EVIDENCE_PATH: "/tmp/wrong.json",
      },
    ];
    for (const drift of cases) {
      const directory = tempDirectory();
      try {
        assert.throws(() =>
          parseOrderPaymentShippingLegacyInspectionConfig(
            environment(directory, drift),
          ),
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("requires the exact clean release checkout", () => {
    assert.deepEqual(
      assertOrderPaymentShippingLegacyInspectionGitState(
        { head: COMMIT, status: "" },
        COMMIT,
      ),
      { clean: true, head: COMMIT },
    );
    assert.throws(() =>
      assertOrderPaymentShippingLegacyInspectionGitState(
        { head: COMMIT, status: " M file" },
        COMMIT,
      ),
    );
    assert.throws(() =>
      assertOrderPaymentShippingLegacyInspectionGitState(
        { head: "d".repeat(40), status: "" },
        COMMIT,
      ),
    );
  });

  it("normalizes only the exact nonnegative aggregate shape", () => {
    assert.equal(ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS.length, 86);
    const normalized = normalizeOrderPaymentShippingLegacyCounts(countRow("2"));
    assert.equal(
      Object.keys(normalized).length,
      ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS.length,
    );
    assert.ok(Object.values(normalized).every((value) => value === 2));
    assert.throws(() =>
      normalizeOrderPaymentShippingLegacyCounts({
        ...countRow(),
        extra: "0",
      }),
    );
    assert.throws(() =>
      normalizeOrderPaymentShippingLegacyCounts({
        ...countRow(),
        order_count: "-1",
      }),
    );
  });

  it("makes workflow success an exact reservation-authority data gate", () => {
    const clean = normalizeOrderPaymentShippingLegacyCounts(countRow());
    assert.deepEqual(reservationAuthorityInspectionDecision(clean), {
      accepted: true,
      rejectedFields: [],
    });
    for (const field of RESERVATION_AUTHORITY_REQUIRED_ZERO_FIELDS) {
      assert.deepEqual(
        reservationAuthorityInspectionDecision({ ...clean, [field]: 1 }),
        { accepted: false, rejectedFields: [field] },
      );
    }
    assert.match(
      workflow,
      /Upload sanitized aggregate evidence\s*\n\s*if: always\(\)/,
    );
  });

  it("keeps one aggregate SELECT and covers every reviewed table", () => {
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /^\s*WITH[\s\S]*\bSELECT\b/,
    );
    assert.doesNotMatch(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\b/i,
    );
    for (const table of ORDER_PAYMENT_SHIPPING_INSPECTION_TABLES) {
      assert.match(
        ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
        new RegExp(`public\\.\\"${table}\\"`),
        table,
      );
    }
    for (const field of [
      "label_state_coherence_count",
      "label_negative_cost_count",
      "label_purchased_missing_transaction_count",
      "label_purchased_missing_url_count",
      "label_purchased_missing_timestamp_count",
      "label_purchased_nonshipping_method_count",
      "label_purchased_invalid_fulfillment_count",
      "label_unpurchased_with_transaction_count",
      "label_unpurchased_with_url_count",
      "label_unpurchased_with_timestamp_count",
      "label_unpurchased_with_cost_count",
      "label_purchased_missing_reference_privacy_redacted_count",
      "label_purchased_missing_reference_unexplained_count",
      "label_clawback_state_coherence_count",
      "label_duplicate_shippo_transaction_identity_count",
      "label_checkout_snapshot_package_candidate_count",
      "label_legacy_live_package_candidate_count",
      "label_unresolvable_package_candidate_count",
      "label_invalid_address_candidate_count",
      "quote_invalid_rate_member_count",
      "duplicate_live_quote_order_count",
      "payment_currency_mismatch_count",
      "payment_blank_event_identity_count",
      "payment_incomplete_object_identity_count",
      "payment_blank_optional_text_count",
      "payment_unknown_source_family_count",
      "payment_signed_source_shape_count",
      "payment_local_source_shape_count",
      "payment_refund_source_shape_count",
      "payment_dispute_source_shape_count",
      "payment_object_cross_order_count",
      "payment_signed_ordering_missing_count",
      "payment_local_ordering_present_count",
      "payment_same_second_dispute_conflict_count",
      "refund_amount_exceeds_order_count",
      "refund_marker_coherence_count",
      "payout_mutated_count",
      "reservation_invalid_item_member_count",
      "reservation_missing_actor_count",
      "reservation_duplicate_active_lock_count",
      "webhook_blank_identity_count",
      "webhook_failed_count",
      "webhook_released_count",
      "webhook_stale_processing_count",
      "webhook_issue_count",
    ]) {
      assert.match(
        ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
        new RegExp(`\\b${field}\\b`),
      );
    }
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /pg_catalog\.count\(DISTINCT \([\s\S]*metadata->>'stripeEventType'[\s\S]*canonical_state_count/,
    );
    assert.match(
      ORDER_PAYMENT_EVENT_LOCAL_SOURCE_INVALID_PREDICATE,
      /'local:seller_refund_recorded:' \|\| event\."stripeObjectId"[\s\S]*'local:blocked_checkout_refund_recorded:' \|\| event\."stripeObjectId"[\s\S]*'local:case_refund_recorded:' \|\| event\."stripeObjectId"/,
    );
    assert.match(
      ORDER_PAYMENT_EVENT_PROVIDER_TIME_EXPRESSION,
      /pg_catalog\.to_jsonb\(event\)->>'stripeEventCreatedSeconds'/,
    );
    for (const clause of [
      /"labelCostCents" < 0/,
      /"labelStatus" = 'PURCHASED'[\s\S]*"shippoTransactionId" IS NULL/,
      /"labelStatus" = 'PURCHASED'[\s\S]*"labelUrl" IS NULL/,
      /"labelStatus" = 'PURCHASED'[\s\S]*"labelPurchasedAt" IS NULL/,
      /"labelStatus" = 'PURCHASED'[\s\S]*"fulfillmentMethod" IS DISTINCT FROM 'SHIPPING'/,
      /"labelStatus" = 'PURCHASED'[\s\S]*"fulfillmentStatus" NOT IN \('SHIPPED', 'DELIVERED'\)/,
      /"labelStatus" IS NULL[\s\S]*"shippoTransactionId" IS NOT NULL/,
      /"labelStatus" IS NULL[\s\S]*"labelUrl" IS NOT NULL/,
      /"labelStatus" IS NULL[\s\S]*"labelPurchasedAt" IS NOT NULL/,
      /"labelStatus" IS NULL[\s\S]*"labelCostCents" IS NOT NULL/,
    ]) {
      assert.match(ORDER_LABEL_STATE_INVALID_PREDICATE, clause);
    }
    for (const field of ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS.filter(
      (field) =>
        (field.startsWith("label_purchased_") &&
          !field.includes("missing_reference_")) ||
        field.startsWith("label_unpurchased_") ||
        field === "label_negative_cost_count",
    )) {
      assert.match(
        ORDER_LABEL_STATE_CLASSIFICATION_PROJECTION,
        new RegExp(`\\b${field}\\b`),
      );
    }
    assert.doesNotMatch(
      ORDER_LABEL_STATE_CLASSIFICATION_PROJECTION,
      /\b(?:id|buyerId|sellerId|shippoTransactionId|labelUrl|labelPurchasedAt|labelCostCents)\s+AS\s+/i,
    );
    assert.doesNotMatch(
      ORDER_LABEL_STATE_CLASSIFICATION_PROJECTION,
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\b/i,
    );
    for (const field of [
      "label_purchased_missing_reference_privacy_redacted_count",
      "label_purchased_missing_reference_unexplained_count",
    ]) {
      assert.match(
        ORDER_LABEL_REFERENCE_REDACTION_CLASSIFICATION_PROJECTION,
        new RegExp(`\\b${field}\\b`),
      );
    }
    assert.match(
      ORDER_LABEL_REFERENCE_REDACTION_CLASSIFICATION_PROJECTION,
      /"buyerDataPurgedAt" IS NOT NULL OR "sellerDeletedAt" IS NOT NULL/,
    );
    assert.match(
      ORDER_LABEL_REFERENCE_REDACTION_CLASSIFICATION_PROJECTION,
      /"buyerDataPurgedAt" IS NULL[\s\S]*"sellerDeletedAt" IS NULL/,
    );
    assert.doesNotMatch(
      ORDER_LABEL_REFERENCE_REDACTION_CLASSIFICATION_PROJECTION,
      /\b(?:id|buyerId|sellerId|shippoTransactionId|labelUrl|labelPurchasedAt|labelCostCents)\s+AS\s+/i,
    );
    assert.doesNotMatch(
      ORDER_LABEL_REFERENCE_REDACTION_CLASSIFICATION_PROJECTION,
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\b/i,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /seller_user\."deletedAt" AS "sellerDeletedAt"/,
    );
    assert.doesNotMatch(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /event\."stripeEventCreatedSeconds"/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /"payloadHash" <> 'deleted'[\s\S]*"payloadHash" !~ '\^\[A-Za-z0-9_-\]\{32\}\$'/,
    );
    assert.doesNotMatch(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /"payloadHash" !~ '\^\[0-9a-f\]\{64\}\$'/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /reservation\."payloadHash" <> 'deleted'[\s\S]*item\.value->'sellerId'/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /reservation\."payloadHash" = 'deleted'[\s\S]*item\.value \? 'sellerId'/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /"payloadHash" = 'deleted'[\s\S]*"checkoutLockKey" <> 'deleted:' \|\| id[\s\S]*status NOT IN \('COMPLETED', 'RESTORED'\)/,
    );
  });

  it("makes label activation fail closed on duplicate provider identity or an unshippable candidate", () => {
    const clean = normalizeOrderPaymentShippingLegacyCounts(countRow());
    assert.deepEqual(orderLabelAuthorityInspectionDecision(clean), {
      accepted: true,
      rejectedFields: [],
    });
    for (const field of ORDER_LABEL_AUTHORITY_REQUIRED_ZERO_FIELDS) {
      assert.deepEqual(
        orderLabelAuthorityInspectionDecision({ ...clean, [field]: 1 }),
        { accepted: false, rejectedFields: [field] },
      );
    }
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /HAVING pg_catalog\.count\(\*\) > 1[\s\S]*label_duplicate_shippo_transaction_identity_count/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /label_package_candidates[\s\S]*shippingPackageComplete[\s\S]*label_package_classification/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /NOT snapshot_resolvable AND live_resolvable[\s\S]*label_legacy_live_package_candidate_count/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /NOT snapshot_resolvable AND NOT live_resolvable[\s\S]*label_unresolvable_package_candidate_count/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /btrim\(orders\."shipToLine1"\)[\s\S]*btrim\(seller\."shipFromLine1"\)[\s\S]*label_invalid_address_candidate_count/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /item\.quantity > 0[\s\S]*live_items[\s\S]*package\.live_items = package\.total_items/,
    );
  });

  it("requires completed service-ledger FORCE and exact remaining predecessor CRUD", () => {
    const script = fs.readFileSync(
      "scripts/order-payment-shipping-legacy-inspect.mjs",
      "utf8",
    );
    const posture =
      normalizeOrderPaymentShippingInspectionPosture(postureRows());
    assert.deepEqual(
      [...ORDER_PAYMENT_SHIPPING_FORCE_TABLES],
      [
        "CheckoutStockReservation",
        "OrderPaymentEvent",
        "SellerPayoutEvent",
        "StripeWebhookEvent",
      ],
    );
    assert.deepEqual(
      [...ORDER_PAYMENT_SHIPPING_PREDECESSOR_TABLES],
      [
        "Order",
        "OrderItem",
        "OrderShippingRateQuote",
      ],
    );
    assert.deepEqual(posture.checkoutStockReservation, {
      rlsEnabled: true,
      rlsForced: true,
      runtimeCrudRetained: false,
    });
    assert.deepEqual(posture.stripeWebhookEvent, {
      rlsEnabled: true,
      rlsForced: true,
      runtimeCrudRetained: false,
    });
    assert.deepEqual(posture.sellerPayoutEvent, {
      rlsEnabled: true,
      rlsForced: true,
      runtimeCrudRetained: false,
    });
    assert.deepEqual(posture.orderPaymentEvent, {
      rlsEnabled: true,
      rlsForced: true,
      runtimeCrudRetained: false,
    });
    assert.deepEqual(posture.remainingPredecessors, {
      tables: ORDER_PAYMENT_SHIPPING_PREDECESSOR_TABLES,
      rlsEnabled: false,
      rlsForced: false,
      legacyRuntimeCrudRetained: true,
    });
    for (const drift of [
      postureRows().slice(1),
      postureRowsWith("CheckoutStockReservation", {
        rls_enabled: false,
        rls_forced: false,
        runtime_can_select: true,
        runtime_can_insert: true,
        runtime_can_update: true,
        runtime_can_delete: true,
      }),
      postureRowsWith("SellerPayoutEvent", {
        rls_enabled: false,
        rls_forced: false,
        runtime_can_select: true,
        runtime_can_insert: true,
        runtime_can_update: true,
        runtime_can_delete: true,
      }),
      postureRowsWith("OrderPaymentEvent", {
        rls_enabled: false,
        rls_forced: false,
        runtime_can_select: true,
        runtime_can_insert: true,
        runtime_can_update: true,
        runtime_can_delete: true,
      }),
      postureRowsWith("Order", { policy_count: "1" }),
      postureRowsWith("OrderItem", {
        owner_name: "grainline_app_runtime",
      }),
    ]) {
      assert.throws(
        () => normalizeOrderPaymentShippingInspectionPosture(drift),
        /database posture is not the reviewed/,
      );
    }
    assert.match(script, /forceTables\.has\(row\.table_name\)/);
    assert.match(
      script,
      /reservation authority candidate has nonzero rejected aggregate counts/,
    );
    assert.match(
      script,
      /status: result\.reservationAuthorityCandidate\.accepted &&[\s\S]*result\.orderLabelAuthorityCandidate\.accepted[\s\S]*\? "passed"[\s\S]*: "blocked"/,
    );
  });

  it("reports only bounded failure classes", () => {
    assert.equal(
      orderPaymentShippingLegacyInspectionFailureCode(
        new Error(
          "Order/payment/shipping inspection database posture is not the reviewed state",
        ),
      ),
      "POSTURE_MISMATCH",
    );
    assert.equal(
      orderPaymentShippingLegacyInspectionFailureCode(
        new Error("DIRECT_URL does not match the protected Production digest"),
      ),
      "CREDENTIAL_DIGEST",
    );
    assert.equal(
      orderPaymentShippingLegacyInspectionFailureCode(
        new Error("secret-bearing unrecognized database failure"),
      ),
      "UNCLASSIFIED",
    );
    const script = fs.readFileSync(
      "scripts/order-payment-shipping-legacy-inspect.mjs",
      "utf8",
    );
    assert.match(
      script,
      /failed closed \[\$\{orderPaymentShippingLegacyInspectionFailureCode\(error\)\}\]/,
    );
    assert.doesNotMatch(script, /process\.stderr\.write\([^)]*error\.message/);
  });

  it("compares application timestamps only to their causal predecessor", () => {
    assert.doesNotMatch(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /"paidAt"\s+IS\s+NOT\s+NULL\s+AND\s+"paidAt"\s*<\s*"createdAt"/i,
    );
    assert.doesNotMatch(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /"processedAt"\s+IS\s+NOT\s+NULL\s+AND\s+"processedAt"\s*<\s*"createdAt"/i,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /"pickedUpAt"\s*<\s*"pickupReadyAt"/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /"deliveredAt"\s*<\s*"shippedAt"/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /"processedAt"\s*<\s*"processingStartedAt"/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /"processedAt" IS NULL[\s\S]*"lastError" IS NOT NULL[\s\S]*AS webhook_failed_count/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /"processedAt" IS NULL[\s\S]*"processingStartedAt" IS NULL[\s\S]*AS webhook_released_count/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /"processingStartedAt" IS NOT NULL[\s\S]*AT TIME ZONE 'UTC'[\s\S]*AS webhook_stale_processing_count/,
    );
    assert.match(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
      /"fulfillmentStatus"\s*=\s*'PICKED_UP'[\s\S]*"pickupReadyAt"\s+IS\s+NULL\s+OR\s+"pickedUpAt"\s+IS\s+NULL/,
    );
  });

  it("writes only private sanitized aggregate evidence", () => {
    const directory = tempDirectory();
    const evidencePath = path.join(directory, "evidence.json");
    try {
      writeOrderPaymentShippingLegacyInspectionEvidence(evidencePath, {
        counts: normalizeOrderPaymentShippingLegacyCounts(countRow()),
        directUrlSha256: "a".repeat(64),
        retained: {
          addresses: false,
          credentials: false,
          objectIds: false,
          providerIds: false,
          rawRows: false,
          snapshots: false,
          userIds: false,
        },
        status: "passed",
      });
      const stat = fs.lstatSync(evidencePath);
      assert.equal(stat.isFile(), true);
      assert.equal(stat.isSymbolicLink(), false);
      assert.equal(stat.mode & 0o077, 0);
      assert.throws(() =>
        writeOrderPaymentShippingLegacyInspectionEvidence(
          path.join(directory, "bad.json"),
          { buyerEmail: "private@example.com" },
        ),
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the script engine-attested read-only", () => {
    const source = fs.readFileSync(
      "scripts/order-payment-shipping-legacy-inspect.mjs",
      "utf8",
    );
    assert.match(
      source,
      /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
    );
    assert.match(source, /transaction_read_only/);
    assert.match(source, /ROLLBACK/);
    assert.match(source, /rawRows: false/);
    const begin = source.indexOf(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const posture = source.indexOf("readPosture(client)", begin);
    const counts = source.indexOf("readCounts(client)", posture);
    const rollback = source.indexOf('client.query("ROLLBACK")', counts);
    assert.ok(
      begin >= 0 && begin < posture && posture < counts && counts < rollback,
    );
  });

  it("wires only a protected aggregate-only production inspection", () => {
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /environment: Production/);
    assert.match(workflow, /group: production-database-migrations/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /permissions:\s+contents: read/);
    assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(
      workflow,
      /ORDER_PAYMENT_SHIPPING_LEGACY_PREREQUISITES_CONFIRMED: service-ledger-force-and-runtime-separation-postflights-passed/,
    );
    assert.match(
      workflow,
      /DIRECT_URL: \$\{\{ secrets\.PRODUCTION_MIGRATION_DIRECT_URL \}\}/,
    );
    assert.match(workflow, /Upload sanitized aggregate evidence/);
    assert.doesNotMatch(workflow, /DATABASE_URL|prisma migrate|vercel|deploy/);
    assert.equal(
      packageJson.scripts["ops:order-payment-shipping-legacy-inspect"],
      "node scripts/order-payment-shipping-legacy-inspect.mjs",
    );
  });
});

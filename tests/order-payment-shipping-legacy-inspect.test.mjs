import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ORDER_PAYMENT_SHIPPING_INSPECTION_TABLES,
  ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS,
  ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_CONFIRMATION,
  ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
  ORDER_PAYMENT_SHIPPING_LEGACY_PREREQUISITE_CONFIRMATION,
  assertOrderPaymentShippingLegacyInspectionGitState,
  normalizeOrderPaymentShippingLegacyCounts,
  parseOrderPaymentShippingLegacyInspectionConfig,
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "order-payment-shipping-inspect-"));
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
      { ORDER_PAYMENT_SHIPPING_LEGACY_INSPECT_EVIDENCE_PATH: "/tmp/wrong.json" },
    ];
    for (const drift of cases) {
      const directory = tempDirectory();
      try {
        assert.throws(() =>
          parseOrderPaymentShippingLegacyInspectionConfig(
            environment(directory, drift),
          )
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
      )
    );
    assert.throws(() =>
      assertOrderPaymentShippingLegacyInspectionGitState(
        { head: "d".repeat(40), status: "" },
        COMMIT,
      )
    );
  });

  it("normalizes only the exact nonnegative aggregate shape", () => {
    assert.equal(ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS.length, 54);
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
      })
    );
    assert.throws(() =>
      normalizeOrderPaymentShippingLegacyCounts({
        ...countRow(),
        order_count: "-1",
      })
    );
  });

  it("keeps one aggregate SELECT and covers every reviewed table", () => {
    assert.match(ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL, /^\s*WITH[\s\S]*\bSELECT\b/);
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
      "label_clawback_state_coherence_count",
      "quote_invalid_rate_member_count",
      "duplicate_live_quote_order_count",
      "payment_currency_mismatch_count",
      "refund_amount_exceeds_order_count",
      "refund_marker_coherence_count",
      "payout_mutated_count",
      "reservation_invalid_item_member_count",
      "reservation_missing_actor_count",
      "reservation_duplicate_active_lock_count",
      "webhook_blank_identity_count",
      "webhook_stale_processing_count",
    ]) {
      assert.match(ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL, new RegExp(`\\b${field}\\b`));
    }
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
        )
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
    assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(source, /transaction_read_only/);
    assert.match(source, /ROLLBACK/);
    assert.match(source, /rawRows: false/);
    const begin = source.indexOf(
      'client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")',
    );
    const posture = source.indexOf("readPosture(client)", begin);
    const counts = source.indexOf("readCounts(client)", posture);
    const rollback = source.indexOf('client.query("ROLLBACK")', counts);
    assert.ok(begin >= 0 && begin < posture && posture < counts && counts < rollback);
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
      /ORDER_PAYMENT_SHIPPING_LEGACY_PREREQUISITES_CONFIRMED: case-force-and-runtime-separation-postflights-passed/,
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

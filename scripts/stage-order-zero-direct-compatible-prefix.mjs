import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

export const ORDER_ZERO_DIRECT_COMPATIBLE_PHASE =
  "order-zero-direct-compatible-prefix";

export const ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS = Object.freeze([
  {
    migration: "20260905010000_correct_order_staff_read_charged_total",
    sha256: "a17597b111b368bba7ff17c16fb196c0c0c336d340987920e91c919d952eaea8",
  },
  {
    migration: "20260905020000_prepare_order_account_deletion_authority",
    sha256: "42847973d67ce2fbc5b8ad449403c96cf46ed1b29fae0cff5004e4390fd17a7f",
  },
  {
    migration: "20260905030000_prepare_order_provider_claim_exclusion",
    draft: "order-provider-claim-exclusion.sql",
    sha256: "0ca3ec670c0cea6f2477ed8f734eb5f973b36603e5c5115263a4c02c7dc5936e",
  },
  {
    migration: "20260905040000_prepare_order_refund_claim_clock_authority",
    draft: "order-refund-claim-clock-authority.sql",
    sha256: "da14cfc4ce1d3fba1755827a45bff428faee157a8b0d5c7ce2dbfe138c678466",
  },
  {
    migration: "20260905050000_prepare_order_seller_refund_preflight_authority",
    draft: "order-seller-refund-preflight-authority.sql",
    sha256: "e79c4dad780f49e988437788e3af3505e766e673e56312e5fcd8dbb0c5217662",
  },
  {
    migration: "20260905060000_prepare_order_legacy_refund_lock_authority",
    draft: "order-legacy-refund-lock-authority.sql",
    sha256: "39a86c3527c431c9dded122b49872316c76108f8098a170e47a3c0127b5e9233",
  },
  {
    migration: "20260905070000_prepare_order_legacy_stock_restore_fence",
    draft: "order-legacy-stock-restore-fence.sql",
    sha256: "58d46054f76e3d594314a5f8af3880d709bca00f0831ad05270c0fdd28926546",
  },
  {
    migration: "20260905080000_prepare_order_refund_reconciliation_commit_proof",
    draft: "order-refund-reconciliation-commit-proof.sql",
    sha256: "46dcd6a6abb0cec071b88a8be51f8e76ab367fb13212cf48b3d02891397c4ef5",
  },
  {
    migration: "20260905090000_prepare_order_staff_mutation_authority",
    draft: "order-staff-mutation-authority.sql",
    sha256: "54469a57437ae93547d091bff47ecfa83336c915624a20bc709f61a1bfaf155e",
  },
  {
    migration: "20260905100000_prepare_order_ban_review_authority",
    draft: "order-ban-review-authority.sql",
    sha256: "48555c6985a64d401f92a92a11b8085568de3ba3e7c9f0a2ebaa6e0bb4502279",
  },
  {
    migration: "20260905110000_prepare_order_checkout_source_snapshot",
    draft: "order-checkout-source-snapshot.sql",
    sha256: "1d7db2450016a20589955c2cb8b8ee44b3a0fe069b1c571d4ca8cd33f7ff3d82",
  },
  {
    migration: "20260905120000_prepare_order_seller_deauthorization_authority",
    draft: "order-seller-deauthorization-authority.sql",
    sha256: "dfc550f8a5e74d38815e39fd941d2f640e97cd713ba5bab81f75e7e59a564445",
  },
  {
    migration: "20260905130000_prepare_order_paid_checkout_authority",
    draft: "order-paid-checkout-authority.sql",
    sha256: "848218b2d53a79df87dc455023d13cff995aba43cf82faf2e0c145c0fd9174b5",
  },
  {
    migration: "20260905140000_prepare_order_checkout_existing_authority",
    draft: "order-checkout-existing-authority.sql",
    sha256: "dce944f4128d4c62c7136819678f82e2233e52871ff1f0361f5af3d570db9a78",
  },
  {
    migration: "20260905150000_prepare_order_checkout_postpayment_authority",
    draft: "order-checkout-postpayment-authority.sql",
    sha256: "aa2176a1da0ff8ed6b43de9350bc9d0b77c4c3cb8393c42b6022c4e10d4812f5",
  },
  {
    migration: "20260905160000_prepare_order_checkout_refund_review_authority",
    draft: "order-checkout-refund-review-authority.sql",
    sha256: "86867bcb9f6b89f56fe0a4d0e268c9cd135e72b1d0620498388f00a33bfbd046",
  },
]);

export const ORDER_ZERO_DIRECT_COMPATIBLE_SUCCESSOR_MIGRATIONS =
  Object.freeze(
    ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS.slice(2).map(
      (member) => member.migration,
    ),
  );

export const ORDER_ZERO_DIRECT_COMPATIBLE_NEW_FUNCTION_NAMES = Object.freeze([
  "grainline_blocked_checkout_legacy_refund_lock_release",
  "grainline_case_legacy_refund_lock_release",
  "grainline_checkout_reservation_create_cart_snapshot",
  "grainline_checkout_reservation_create_single_snapshot",
  "grainline_checkout_reservation_listing_snapshot_witness",
  "grainline_order_flag_banned_seller_open_orders",
  "grainline_order_legacy_refund_lock_prune",
  "grainline_order_refund_claim_provider_clock",
  "grainline_order_refund_reconciliation_committed",
  "grainline_order_restore_banned_seller_reviews",
  "grainline_order_staff_append_note",
  "grainline_order_staff_mark_reviewed",
  "grainline_order_staff_record_label_voided",
  "grainline_seller_deauthorization_application_immutable",
  "grainline_seller_refund_preflight",
  "grainline_stripe_checkout_order_create",
  "grainline_stripe_checkout_order_existing",
  "grainline_stripe_checkout_postpayment",
  "grainline_stripe_checkout_refund_review",
  "grainline_stripe_seller_deauthorization_apply",
]);
export const ORDER_ZERO_DIRECT_COMPATIBLE_PUBLIC_REVOKE_COUNT = 21;

export const ORDER_ZERO_DIRECT_COMPATIBLE_RUNTIME_FUNCTIONS = Object.freeze([
  ["grainline_order_refund_claim_provider_clock", "text, bigint, text, text, bigint, text"],
  ["grainline_seller_refund_preflight", "text, text"],
  ["grainline_blocked_checkout_legacy_refund_lock_release", "text, bigint, text, text"],
  ["grainline_case_legacy_refund_lock_release", "text, text"],
  ["grainline_order_legacy_refund_lock_prune", "integer"],
  ["grainline_legacy_stock_restore_claim", "text"],
  ["grainline_order_refund_reconciliation_committed", "text, text, bigint"],
  ["grainline_order_staff_mark_reviewed", "text, text"],
  ["grainline_order_staff_record_label_voided", "text, text"],
  ["grainline_order_staff_append_note", "text, text, text"],
  ["grainline_order_flag_banned_seller_open_orders", "text, text"],
  ["grainline_order_restore_banned_seller_reviews", "text, text, jsonb"],
  ["grainline_checkout_reservation_create_cart_snapshot", "text, text, text, text, text, jsonb"],
  ["grainline_checkout_reservation_create_single_snapshot", "text, text, integer, text[], text, jsonb"],
  ["grainline_stripe_seller_deauthorization_apply", "text, bigint, text, timestamp without time zone"],
  ["grainline_stripe_checkout_order_create", "text, bigint, text, text, timestamp without time zone, jsonb"],
  ["grainline_stripe_checkout_order_existing", "text, bigint, text"],
  ["grainline_stripe_checkout_postpayment", "text, bigint, text"],
  ["grainline_stripe_checkout_refund_review", "text, bigint, text, text, text"],
].map((entry) => Object.freeze(entry)));

export const ORDER_ZERO_DIRECT_COMPATIBLE_PRIVATE_FUNCTIONS = Object.freeze([
  ["grainline_checkout_reservation_listing_snapshot_witness", "text"],
  ["grainline_seller_deauthorization_application_immutable", ""],
].map((entry) => Object.freeze(entry)));

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function migrationPath(root, migration) {
  return path.join(root, "prisma", "migrations", migration, "migration.sql");
}

function draftPath(root, draft) {
  return path.join(root, "docs", "rls-drafts", draft);
}

function assertDigest(bytes, expected, label) {
  const actual = digest(bytes);
  if (actual !== expected) {
    throw new Error(`${label} checksum drift: expected ${expected}, received ${actual}`);
  }
}

export function verifyOrderZeroDirectCompatiblePrefix({
  root = REPO_ROOT,
  write = false,
} = {}) {
  const expectedNames = ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS.map(
    (member) => member.migration,
  );
  const lowerBound = expectedNames[0];
  const upperBound = expectedNames.at(-1);

  for (const member of ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS) {
    const target = migrationPath(root, member.migration);
    let expectedBytes;
    if (member.draft) {
      expectedBytes = fs.readFileSync(draftPath(root, member.draft));
      assertDigest(expectedBytes, member.sha256, `draft ${member.draft}`);
      if (write && !fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, expectedBytes, { flag: "wx", mode: 0o644 });
      }
    }
    const migrationBytes = fs.readFileSync(target);
    assertDigest(migrationBytes, member.sha256, `migration ${member.migration}`);
    if (expectedBytes && !migrationBytes.equals(expectedBytes)) {
      throw new Error(`${member.migration} does not exactly match ${member.draft}`);
    }
  }

  const migrationRoot = path.join(root, "prisma", "migrations");
  const inRange = fs.readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name >= lowerBound && name <= upperBound)
    .sort();
  if (JSON.stringify(inRange) !== JSON.stringify(expectedNames)) {
    throw new Error("Order zero-direct compatible migration range is not exact");
  }

  return {
    phase: ORDER_ZERO_DIRECT_COMPATIBLE_PHASE,
    memberCount: expectedNames.length,
    generatedMemberCount: ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS.filter(
      (member) => Boolean(member.draft),
    ).length,
    firstMigration: lowerBound,
    lastMigration: upperBound,
  };
}

export function appendReviewedOrderZeroDirectCompatibleSuccessors({
  root = REPO_ROOT,
  laterMigrations,
  reviewedSuccessors,
  expectedPredecessor,
}) {
  if (!Array.isArray(laterMigrations) || !Array.isArray(reviewedSuccessors)) {
    throw new TypeError("laterMigrations and reviewedSuccessors must be arrays");
  }
  const present = ORDER_ZERO_DIRECT_COMPATIBLE_SUCCESSOR_MIGRATIONS.filter(
    (migration) => laterMigrations.includes(migration),
  );
  if (present.length === 0) return false;
  assert.deepEqual(
    present,
    ORDER_ZERO_DIRECT_COMPATIBLE_SUCCESSOR_MIGRATIONS,
    "Order zero-direct compatible successors must be complete and ordered",
  );
  assert.equal(
    reviewedSuccessors.at(-1),
    expectedPredecessor,
    "Order zero-direct compatible prefix requires its exact reviewed predecessor",
  );
  verifyOrderZeroDirectCompatiblePrefix({ root });
  reviewedSuccessors.push(...ORDER_ZERO_DIRECT_COMPATIBLE_SUCCESSOR_MIGRATIONS);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const allowed = new Set(["--write"]);
  const unknown = process.argv.slice(2).filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  }
  console.log(JSON.stringify(verifyOrderZeroDirectCompatiblePrefix({
    write: process.argv.includes("--write"),
  })));
}

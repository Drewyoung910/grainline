import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ORDER_PAYMENT_EVENT_ACTIVATION_FUNCTION_IDENTITIES,
  ORDER_PAYMENT_EVENT_CROSS_SYSTEM_DIRECT_FUNCTION_IDENTITIES,
  ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES,
  ORDER_PAYMENT_EVENT_OWN_DIRECT_FUNCTION_IDENTITIES,
  ORDER_PAYMENT_EVENT_PRIVATE_FUNCTION_IDENTITIES,
  ORDER_PAYMENT_EVENT_RETIRED_RUNTIME_FUNCTION_IDENTITIES,
  ORDER_PAYMENT_EVENT_RUNTIME_FUNCTION_IDENTITIES,
  orderPaymentEventActivationFunctionCatalog,
  orderPaymentEventActivationFunctionSources,
} from "../scripts/order-payment-event-activation-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
  ORDER_PAYMENT_EVENT_ACTIVATION_PHASE,
  buildOrderPaymentEventActivationCandidate,
} from "../scripts/build-order-payment-event-activation-candidate.mjs";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

test("activation catalog composes every latest sealed function exactly once", () => {
  const sources = orderPaymentEventActivationFunctionSources();
  const catalog = orderPaymentEventActivationFunctionCatalog();
  assert.equal(Object.keys(sources).length, 29);
  assert.equal(catalog.length, 29);
  assert.deepEqual(
    Object.keys(sources),
    [...ORDER_PAYMENT_EVENT_ACTIVATION_FUNCTION_IDENTITIES],
  );
  assert.equal(ORDER_PAYMENT_EVENT_RUNTIME_FUNCTION_IDENTITIES.length, 16);
  assert.equal(ORDER_PAYMENT_EVENT_RETIRED_RUNTIME_FUNCTION_IDENTITIES.length, 2);
  assert.equal(ORDER_PAYMENT_EVENT_PRIVATE_FUNCTION_IDENTITIES.length, 11);
  assert.equal(catalog.filter((entry) => entry.runtimeBefore).length, 18);
  assert.equal(catalog.filter((entry) => entry.runtimeAfter).length, 16);
  assert.equal(ORDER_PAYMENT_EVENT_CROSS_SYSTEM_DIRECT_FUNCTION_IDENTITIES.length, 7);
  assert.equal(ORDER_PAYMENT_EVENT_OWN_DIRECT_FUNCTION_IDENTITIES.length, 18);
  assert.equal(ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES.length, 25);
  assert.deepEqual(
    Object.entries(sources)
      .filter(([, source]) => source.includes('"OrderPaymentEvent"'))
      .map(([identity]) => identity),
    [...ORDER_PAYMENT_EVENT_OWN_DIRECT_FUNCTION_IDENTITIES],
  );

  const refund = sources[
    "grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)"
  ];
  assert.match(refund, /local_refund_identity_derived/);
  const dispute = sources[
    "grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)"
  ];
  assert.match(dispute, /p_dispute_id !~ '\^du_/);
  assert.doesNotMatch(dispute, /p_dispute_id !~ '\^dp_/);
  assert.match(
    sources[
      "grainline_blocked_checkout_transfer_bind(text,bigint,text,text,text,text,text)"
    ],
    /Blocked-checkout transfer binding/,
  );
  assert.deepEqual(
    Object.entries(sources)
      .filter(([, source]) => /pg_catalog\.format\(/u.test(source))
      .map(([identity]) => identity)
      .sort(),
    [
      "grainline_blocked_checkout_refund_record_core(text,bigint,text,bigint,text,text,text,integer)",
      "grainline_seller_refund_record(text,text,bigint,text,text,text,integer)",
    ],
  );
  for (const [identity, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /\bEXECUTE\b/iu, identity);
  }
});

test("tracked application calls only the 16 retained runtime operations", () => {
  const sourceFiles = execFileSync("git", ["ls-files", "-z", "--", "src"], {
    encoding: "utf8",
  }).split("\0").filter(Boolean).filter((file) =>
    new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]).has(path.extname(file))
  );
  const sources = sourceFiles.map((file) => fs.readFileSync(file, "utf8"));
  const names = [...new Set(ORDER_PAYMENT_EVENT_ACTIVATION_FUNCTION_IDENTITIES.map(
    (identity) => identity.slice(0, identity.indexOf("(")),
  ))];
  const called = names.filter((name) => {
    const pattern = new RegExp(`\\b${name}\\s*\\(`, "u");
    return sources.some((source) => pattern.test(source));
  }).sort();
  assert.deepEqual(
    called,
    ORDER_PAYMENT_EVENT_RUNTIME_FUNCTION_IDENTITIES.map(
      (identity) => identity.slice(0, identity.indexOf("(")),
    ).sort(),
  );
  for (const identity of ORDER_PAYMENT_EVENT_RETIRED_RUNTIME_FUNCTION_IDENTITIES) {
    const name = identity.slice(0, identity.indexOf("("));
    const pattern = new RegExp(`\\b${name}\\s*\\(`, "u");
    assert.equal(sources.some((source) => pattern.test(source)), false, name);
  }
});

test("activation migration is policyless, data-preserving and byte-derived", () => {
  const candidate = buildOrderPaymentEventActivationCandidate();
  const migrationPath = path.join(
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
    "migration.sql",
  );
  assert.equal(fs.readFileSync(migrationPath, "utf8"), candidate.migration);
  assert.equal(
    fs.readFileSync("docs/rls-drafts/order-payment-event-activation.sql", "utf8"),
    candidate.draft,
  );
  assert.equal(
    fs.readFileSync(
      "docs/rls-drafts/order-payment-event-activation-rollback.sql",
      "utf8",
    ),
    candidate.rollback,
  );
  assert.equal(ORDER_PAYMENT_EVENT_ACTIVATION_PHASE,
    "order-payment-event-activation-reviewed");
  assert.match(candidate.migration,
    /ALTER TABLE public\."OrderPaymentEvent" ENABLE ROW LEVEL SECURITY;/);
  assert.match(candidate.migration,
    /ALTER TABLE public\."OrderPaymentEvent" NO FORCE ROW LEVEL SECURITY;/);
  assert.match(candidate.migration,
    /REVOKE ALL ON TABLE public\."OrderPaymentEvent"/);
  assert.match(candidate.migration,
    /table_owner <> \(\s*SELECT role\.oid[\s\S]*role\.rolname = CURRENT_USER/u);
  assert.match(candidate.migration,
    /CURRENT_USER = 'neondb_owner'/u);
  assert.match(candidate.migration,
    /CURRENT_USER = 'ci'[\s\S]*CURRENT_DATABASE\(\) = 'grainline_ci'/u);
  assert.doesNotMatch(candidate.migration,
    /pg_get_userbyid\(table_owner\) <> 'neondb_owner'/u);
  assert.match(candidate.migration,
    /strpos\(pg_catalog\.upper\(prosrc\), 'EXECUTE'\) = 0/u);
  assert.doesNotMatch(candidate.migration,
    /strpos\(pg_catalog\.upper\(prosrc\), 'FORMAT\('/u);
  assert.doesNotMatch(candidate.migration, /\bCREATE\s+POLICY\b/iu);
  assert.doesNotMatch(candidate.migration, /\bDROP\s+POLICY\b/iu);
  assert.doesNotMatch(candidate.migration,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/iu);
  assert.doesNotMatch(candidate.migration,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/imu);
  assert.equal(count(candidate.migration,
    /REVOKE ALL ON FUNCTION public\.grainline_(?:blocked_checkout_refund_claim|case_seller_refund_apply)\(/gu), 2);
  assert.equal(count(candidate.rollback,
    /GRANT EXECUTE ON FUNCTION public\.grainline_(?:blocked_checkout_refund_claim|case_seller_refund_apply)\(/gu), 2);
  assert.equal(count(candidate.migration, /IF function_count <> 29/gu), 2);
  assert.equal(count(candidate.migration, /IF named_function_count <> 29/gu), 2);
  assert.match(candidate.migration,
    /IF direct_function_count <> 25[\s\S]*reviewed_direct_function_count <> 25/u);
  assert.match(candidate.migration,
    /procedure\.proname \|\| '\(' \|\| pg_catalog\.replace\([\s\S]*oidvectortypes/u);
  for (const identity of ORDER_PAYMENT_EVENT_CROSS_SYSTEM_DIRECT_FUNCTION_IDENTITIES) {
    assert.ok(candidate.migration.includes(`('${identity}')`), identity);
  }
});

test("direct-reference trust is exact-signature scoped", () => {
  assert.deepEqual(
    ORDER_PAYMENT_EVENT_CROSS_SYSTEM_DIRECT_FUNCTION_IDENTITIES,
    [
      "grainline_case_open(text,text,text,text)",
      "grainline_case_relationship_valid()",
      "grainline_case_staff_resolution_finalize(text,text)",
      "grainline_case_staff_resolution_prepare(text,text,\"CaseResolution\",integer,jsonb)",
      "grainline_case_staff_resolution_provider_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)",
      "grainline_case_stripe_dispute_apply(text)",
      "grainline_notification_create_core(text,text,\"NotificationType\",text,text,text)",
    ],
  );
  assert.equal(
    ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES.includes(
      "grainline_case_stripe_dispute_apply(text,text)",
    ),
    false,
  );
});

test("activation SQL embeds every exact source digest and final grant class", () => {
  const candidate = buildOrderPaymentEventActivationCandidate();
  const compact = candidate.migration.replace(/\s+/gu, " ");
  for (const entry of orderPaymentEventActivationFunctionCatalog()) {
    assert.ok(
      compact.includes(
        `'${entry.name}', '${entry.identityArguments}', '${entry.language}', '${entry.volatility}', '${entry.parallelSafety}', ${entry.securityDefiner}, ${entry.runtimeBefore}, '${entry.sourceMd5}'`,
      ),
      `predecessor row missing for ${entry.identity}`,
    );
    assert.ok(
      compact.includes(
        `'${entry.name}', '${entry.identityArguments}', '${entry.language}', '${entry.volatility}', '${entry.parallelSafety}', ${entry.securityDefiner}, ${entry.runtimeAfter}, '${entry.sourceMd5}'`,
      ),
      `activated row missing for ${entry.identity}`,
    );
  }
});

test("activation is wired as a separate guarded CI and production release", () => {
  const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const production = fs.readFileSync(
    ".github/workflows/production-migrations.yml",
    "utf8",
  );
  for (const workflow of [ci, production]) {
    assert.match(
      workflow,
      /SAVED_SEARCH_RLS_DEPLOY_PHASE: order-payment-event-activation-reviewed/u,
    );
    assert.match(
      workflow,
      /audit:order-payment-event-activation-release/u,
    );
  }
  assert.match(ci, /Isolate OrderPaymentEvent activation until transition authority passes/u);
  assert.match(ci, /Apply OrderPaymentEvent policyless activation/u);
  assert.match(ci, /audit:order-payment-event-activation-postgres/u);
  assert.match(ci, /audit:order-payment-event-activation-rollback/u);
  assert.match(
    production,
    /ORDER_PAYMENT_EVENT_ACTIVATION_SCOPE_STAGE: restart/u,
  );
  assert.match(
    production,
    /ORDER_PAYMENT_EVENT_ACTIVATION_SCOPE_STAGE: after/u,
  );
  const transitionVerify = production.indexOf(
    "Verify isolated OrderPaymentEvent transition-authority successor",
  );
  const aggregateVerify = production.indexOf(
    "Verify isolated OrderPaymentEvent aggregate-authority successor",
  );
  const readVerify = production.indexOf(
    "Verify isolated OrderPaymentEvent read-authority successor",
  );
  const invariantVerify = production.indexOf(
    "Verify isolated OrderPaymentEvent invariant successor",
  );
  const transferVerify = production.indexOf(
    "Verify blocked-checkout transfer binding migration bytes",
  );
  const predecessorScope = production.indexOf(
    "Prove exact OrderPaymentEvent transition-authority predecessor scope",
  );
  const sellerForceVerify = production.indexOf(
    "Verify exact SellerPayoutEvent FORCE migration tree",
  );
  const restoreChain = production.indexOf(
    "Restore the complete reviewed OrderPaymentEvent release chain",
  );
  const restoredTreeVerify = production.indexOf(
    "Verify restored exact OrderPaymentEvent activation migration tree",
  );
  const prismaDeploy = production.indexOf("Apply production migrations");
  const postSellerMigrations = [
    "20260824010000_prepare_order_refund_claim_generation",
    "20260824020000_prepare_order_refund_record_authority",
    "20260824030000_prepare_order_payment_signed_authority",
    "20260824040000_prepare_order_refund_reconciliation_authority",
    "20260824050000_prepare_order_refund_inactive_seller_recovery",
    "20260825010000_prepare_blocked_checkout_refund_delivery",
    "20260826010000_prepare_blocked_checkout_transfer_binding",
    "20260828010000_prepare_order_payment_signed_refund_identity",
    "20260828020000_correct_order_payment_signed_dispute_identity",
    "20260829010000_prepare_order_payment_event_invariants",
    "20260829020000_prepare_order_payment_event_read_authority",
    "20260830010000_prepare_order_payment_event_aggregate_authority",
    "20260830020000_prepare_order_payment_event_transition_authority",
    "20260830030000_enable_order_payment_event_rls",
  ];
  assert.ok(transitionVerify >= 0);
  assert.ok(aggregateVerify > transitionVerify);
  assert.ok(readVerify > aggregateVerify);
  assert.ok(invariantVerify > readVerify);
  assert.ok(transferVerify > invariantVerify);
  assert.ok(predecessorScope > transferVerify);
  assert.ok(sellerForceVerify > predecessorScope);
  assert.ok(restoreChain > sellerForceVerify);
  assert.ok(restoredTreeVerify > restoreChain);
  assert.ok(prismaDeploy > restoredTreeVerify);
  for (const command of [
    "audit:order-payment-signed-dispute-identity-release",
    "audit:order-payment-blocked-checkout-transfer-binding-release",
    "audit:order-payment-blocked-checkout-refund-delivery-release",
    "audit:order-refund-inactive-seller-recovery-release",
    "audit:order-refund-reconciliation-authority-release",
  ]) {
    const position = production.indexOf(command);
    assert.ok(position >= 0, `${command} must be wired`);
    assert.ok(
      position < predecessorScope,
      `${command} must verify bytes before the complete production scope proof`,
    );
  }
  const prefixSensitiveVerifiers = new Map([
    [
      "audit:order-payment-signed-refund-identity-release",
      "20260828010000_prepare_order_payment_signed_refund_identity",
    ],
    [
      "audit:order-payment-signed-authority-release",
      "20260824030000_prepare_order_payment_signed_authority",
    ],
    [
      "audit:order-refund-record-authority-release",
      "20260824020000_prepare_order_refund_record_authority",
    ],
    [
      "audit:order-refund-claim-generation-release",
      "20260824010000_prepare_order_refund_claim_generation",
    ],
  ]);
  for (const [command, migration] of prefixSensitiveVerifiers) {
    const verifier = production.indexOf(command);
    const isolate = production.indexOf(`prisma/migrations/${migration}`);
    assert.ok(verifier > predecessorScope, `${command} must follow the full live scope proof`);
    assert.ok(
      verifier < isolate,
      `${command} must run at its exact historical prefix before isolation`,
    );
  }
  for (const migration of postSellerMigrations) {
    const migrationPath = `prisma/migrations/${migration}`;
    assert.equal(
      production.split(migrationPath).length - 1,
      2,
      `${migration} must be isolated once and restored once`,
    );
    const isolate = production.indexOf(migrationPath);
    const restore = production.lastIndexOf(migrationPath);
    assert.ok(
      isolate > predecessorScope && isolate < sellerForceVerify,
      `${migration} must be isolated only after full predecessor proof and before the SellerPayoutEvent tree guard`,
    );
    assert.ok(
      restore > restoreChain && restore < restoredTreeVerify,
      `${migration} must be restored before the final activation-tree re-verification`,
    );
  }
  assert.match(
    production,
    /Prove exact OrderPaymentEvent transition-authority predecessor scope[\s\S]*ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_SCOPE_STAGE: after/u,
  );
  assert.doesNotMatch(production, /steps\.transfer_scope/u);
  assert.doesNotMatch(
    fs.readFileSync(
      `prisma/migrations/${ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION}/migration.sql`,
      "utf8",
    ),
    /ALTER TABLE public\."OrderPaymentEvent" FORCE ROW LEVEL SECURITY/u,
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ORDER_LABEL_AUTHORITY_FUNCTIONS,
  ORDER_LABEL_PRIVATE_FUNCTIONS,
  verifyOrderLabelAuthorityMigrationBytes,
} from "../scripts/order-label-authority-catalog.mjs";

const source = (path) => readFileSync(path, "utf8");
const { migration } = verifyOrderLabelAuthorityMigrationBytes();

describe("Order label fixed-authority release", () => {
  it("seals the compatible migration without changing Order RLS or base-table grants", () => {
    assert.match(migration, /^-- Compatible fixed authority/);
    assert.match(migration, /BEGIN;[\s\S]*COMMIT;\s*$/);
    assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
    assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE).*ON (?:TABLE )?public\."Order"/);
    for (const identity of ORDER_LABEL_AUTHORITY_FUNCTIONS) {
      const name = identity.slice(0, identity.indexOf("("));
      assert.match(migration, new RegExp(`CREATE FUNCTION public\\.${name}\\(`), name);
    }
    for (const identity of ORDER_LABEL_PRIVATE_FUNCTIONS) {
      const name = identity.slice(0, identity.indexOf("("));
      assert.match(migration, new RegExp(`CREATE FUNCTION public\\.${name}\\(`), name);
    }
    assert.equal((migration.match(/SECURITY DEFINER/g) ?? []).length, 10);
    assert.equal((migration.match(/SET search_path = pg_catalog/g) ?? []).length, 10);
    assert.equal((migration.match(/FROM PUBLIC;/g) ?? []).length, 10);
    assert.equal((migration.match(/TO grainline_app_runtime;/g) ?? []).length, 8);
  });

  it("keeps all security-relevant purchase identity database-derived", () => {
    assert.match(migration, /claim_id := 'order-label-claim:' \|\| pg_catalog\.gen_random_uuid\(\)::text/);
    assert.match(migration, /claim_generation := locked_order\."labelClaimGeneration" \+ 1/);
    assert.match(migration, /selected_rate_id := p_rate_object_id/);
    assert.match(migration, /selected_amount := \(selected_rate->>'amountCents'\)::integer/);
    assert.match(migration, /p_provider_rate_object_id IS DISTINCT FROM locked_order\."labelClaimRateObjectId"/);
    assert.match(migration, /p_amount_cents IS DISTINCT FROM locked_order\."labelClaimExpectedAmountCents"/);
    assert.match(migration, /"labelClaimStatus" = 'PROVIDER_AMBIGUOUS'/);
    assert.match(migration, /IF locked_order\."labelClaimStatus" <> 'PROVIDER_PENDING'/);
    assert.match(migration, /'ORDER_LABEL_AMBIGUOUS_RELEASED'/);
    assert.match(migration, /interval '1 hour'/);
    assert.match(migration, /FOR UPDATE OF source_order SKIP LOCKED/);
    assert.match(migration, /"labelClawbackGeneration" = target_order\."labelClawbackGeneration" \+ 1/);
  });

  it("removes direct label-path table access and never returns a raw label URL", () => {
    const route = source("src/app/api/orders/[id]/label/route.ts");
    const worker = source("src/lib/labelClawbackRetry.ts");
    const component = source("src/components/LabelSection.tsx");
    const detailAuthority = source("src/lib/orderParticipantDetailAuthority.ts");
    const detailState = source("src/lib/orderParticipantDetailState.ts");
    assert.doesNotMatch(route, /\bprisma\.(?:order|orderShippingRateQuote)|\btx\.order/);
    assert.doesNotMatch(worker, /\bprisma\.order|\btx\.order/);
    assert.match(route, /sellerLabelPreflight/);
    assert.match(route, /claimSellerLabelPurchase/);
    assert.match(route, /finalizeSellerLabelProviderResult/);
    assert.match(route, /sellerLabelDownload/);
    assert.ok(
      (route.match(/transaction\.test !== shippoCredentialTestMode\(\)/g) ?? []).length >= 2,
    );
    assert.match(route, /source: "shippo_label_mode_mismatch"/);
    assert.doesNotMatch(route, /return privateJson\(\{[\s\S]{0,200}labelUrl/);
    assert.match(component, /href=\{`\/api\/orders\/\$\{orderId\}\/label`\}/);
    assert.doesNotMatch(component, /labelUrl/);
    assert.match(detailAuthority, /grainline_order_seller_detail_v4/);
    assert.doesNotMatch(detailState, /labelUrl|label_url/);
    const v4 = migration.slice(
      migration.indexOf("CREATE FUNCTION public.grainline_order_seller_detail_v4"),
      migration.indexOf("REVOKE ALL ON FUNCTION public.grainline_order_seller_label_preflight"),
    );
    assert.match(v4, /detail\.label_status,[\s\S]*detail\.label_carrier/);
    assert.doesNotMatch(v4, /\blabel_url\b/);
  });

  it("co-commits shipped side effects and retains new checkout package facts", () => {
    const finalization = source("src/lib/orderLabelFinalization.ts");
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const paidCheckoutAuthority = source("docs/rls-drafts/order-paid-checkout-authority.sql");
    const snapshotHelper = source("src/lib/orderItemSnapshot.ts");
    const cartCheckout = source("src/app/api/cart/checkout-seller/route.ts");
    const singleCheckout = source("src/app/api/cart/checkout/single/route.ts");
    const notificationAuthority = source(
      "prisma/migrations/20260722051500_prepare_notification_rls/migration.sql",
    );
    assert.match(finalization, /prisma\.\$transaction/);
    assert.match(finalization, /recordSellerLabelProviderResult\(input, tx\)/);
    assert.doesNotMatch(finalization, /createNotification(?:OrThrow)?/);
    assert.match(migration, /'ORDER_FULFILLMENT_TRANSITION'/);
    assert.match(migration, /'action', 'shipped', 'newStatus', 'SHIPPED'/);
    assert.match(migration, /'trackingCarrier', p_carrier/);
    assert.match(migration, /source_order\."sellerProfileId"|locked_order\."sellerProfileId"/);
    assert.match(migration, /'ORDER_SHIPPED'::public\."NotificationType"/);
    assert.match(migration, /'order_fulfillment',[\s\S]{0,100}audit_id/);
    assert.match(migration, /ON CONFLICT \("userId", type, "dedupKey"\) DO NOTHING/);
    assert.match(
      notificationAuthority,
      /source_audit\.action = 'ORDER_FULFILLMENT_TRANSITION'[\s\S]{0,800}source_audit\.metadata ->> 'action' IN \('shipped', 'picked_up', 'ready_for_pickup'\)/,
    );
    assert.match(finalization, /enqueueEmailOutboxOnce/);
    for (const field of [
      "shippingWeightGrams", "shippingLengthCm", "shippingWidthCm",
      "shippingHeightCm", "shippingPackageComplete",
    ]) {
      assert.ok((snapshotHelper.match(new RegExp(field, "g")) ?? []).length >= 2, field);
    }
    assert.match(cartCheckout, /checkoutShippingPackageMetadata/);
    assert.match(singleCheckout, /checkoutShippingPackageMetadata/);
    assert.doesNotMatch(webhook, /readCheckoutShippingPackageMetadata/);
    assert.match(paidCheckoutAuthority, /source_item#>>'\{listing,packagedWeightGrams\}'/);
    assert.match(paidCheckoutAuthority, /source_snapshot#>>'\{seller,defaultPkgWeightGrams\}'/);
    assert.match(paidCheckoutAuthority, /'shippingPackageComplete', source_package_complete/);
    assert.doesNotMatch(
      webhook,
      /shippingWeightGrams:\s*\n?\s*listing(?:Data)?\?*\.packagedWeightGrams/,
    );
  });

  it("converges runtime grants while preserving a fail-closed release boundary", () => {
    const provision = source("scripts/provision-runtime-db-role.sql");
    const compactProvision = provision.replaceAll(/\s+/g, "");
    for (const identity of ORDER_LABEL_AUTHORITY_FUNCTIONS) {
      const sqlIdentity = `public.\"${identity.slice(0, identity.indexOf("("))}\"${identity.slice(identity.indexOf("("))}`;
      assert.ok(compactProvision.includes(sqlIdentity), identity);
    }
    for (const identity of ORDER_LABEL_PRIVATE_FUNCTIONS) {
      const sqlIdentity = `public.\"${identity.slice(0, identity.indexOf("("))}\"${identity.slice(identity.indexOf("("))}`;
      assert.ok(compactProvision.includes(sqlIdentity), identity);
      assert.doesNotMatch(
        compactProvision,
        new RegExp(`GRANTEXECUTEONFUNCTION${sqlIdentity.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}TO`),
        `${identity} must remain migration-owner-only`,
      );
    }
    const audit = source("docs/order-label-product-authority-audit.md");
    assert.match(audit, /production inspection proving `shippoTransactionId` has no\s+duplicates/);
    assert.match(audit, /legacy Orders that will require `LEGACY_LIVE` package\s+fallback/);
    assert.match(audit, /raw `labelUrl` no longer crosses any\s+ordinary-runtime database authority boundary/);
    assert.match(audit, /bounded ambiguous-claim operator path is now implemented/);
    assert.match(audit, /No-transaction evidence is therefore\s+diagnostic only/);
    const operator = source("scripts/order-label-ambiguous-reconciliation-operator.mjs");
    assert.match(operator, /grainline_order_label_ambiguous_claim_read/);
    assert.match(operator, /grainline_order_label_ambiguous_release/);
    assert.match(operator, /ordinary runtime cannot call/i);
    assert.match(audit, /Production remains unchanged/);
  });

  it("keeps later compatible successors outside every historical FORCE gate", () => {
    const workflow = source(".github/workflows/ci.yml");
    const packageSource = source("package.json");
    const chargedTotalVerify = workflow.indexOf(
      "Verify compatible Order charged-total witness",
    );
    const chargedTotalIsolate = workflow.indexOf(
      "Isolate Order charged-total witness until label authority passes",
    );
    const labelVerify = workflow.indexOf(
      "Verify compatible Order label authority release",
    );
    const labelIsolate = workflow.indexOf(
      "Isolate Order label authority until fulfillment authority passes",
    );
    const fulfillmentVerify = workflow.indexOf(
      "Verify compatible Order fulfillment authority release",
    );
    const fulfillmentIsolate = workflow.indexOf(
      "Isolate Order fulfillment authority until receipt Notification authority passes",
    );
    const receiptVerify = workflow.indexOf(
      "Verify compatible Order receipt Notification authority release",
    );
    const receiptIsolate = workflow.indexOf(
      "Isolate Order receipt Notification authority until checkout receipt authority passes",
    );
    const forceVerify = workflow.indexOf(
      "Verify OrderPaymentEvent FORCE migration tree",
    );
    assert.ok(
      chargedTotalVerify >= 0
      && chargedTotalVerify < chargedTotalIsolate
      && chargedTotalIsolate < labelVerify
      && labelVerify < labelIsolate
      && labelIsolate < fulfillmentVerify
      && fulfillmentVerify < fulfillmentIsolate
      && fulfillmentIsolate < receiptVerify
      && receiptVerify < receiptIsolate
      && receiptIsolate < forceVerify,
      "later compatible releases must be verified and isolated before the historical FORCE gate",
    );

    const receiptRestore = workflow.indexOf(
      "Restore compatible Order receipt Notification authority release",
    );
    const fulfillmentRestore = workflow.indexOf(
      "Restore compatible Order fulfillment authority release",
    );
    const labelRestore = workflow.indexOf(
      "Restore compatible Order label authority release",
    );
    const chargedTotalRestore = workflow.indexOf(
      "Restore compatible Order charged-total witness",
    );
    const compatibleApply = workflow.indexOf(
      "Apply compatible Order participant authority",
    );
    assert.ok(
      receiptRestore >= 0
      && receiptRestore < fulfillmentRestore
      && fulfillmentRestore < labelRestore
      && labelRestore < chargedTotalRestore
      && chargedTotalRestore < compatibleApply,
      "compatible successors must be restored in migration order before application",
    );
    for (const applicationProof of [
      "tests/order-payment-event-aggregate-authority-app.test.mjs",
      "tests/order-payment-event-transition-authority-app.test.mjs",
    ]) {
      const restoredApplicationProof = workflow.indexOf(applicationProof);
      assert.ok(
        restoredApplicationProof > chargedTotalRestore,
        `${applicationProof} reads later migration sources and must run only after restoration`,
      );
      assert.equal(
        workflow.match(new RegExp(applicationProof.replaceAll(".", "\\."), "g"))?.length,
        1,
      );
    }
    for (const command of [
      "audit:order-receipt-notification-authority-release",
      "audit:order-fulfillment-authority-release",
      "audit:order-label-authority-release",
      "audit:order-charged-total-compatibility",
    ]) {
      assert.match(packageSource, new RegExp(`\"${command}\"`), command);
    }
  });
});

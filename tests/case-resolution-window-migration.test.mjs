import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const migration = fs.readFileSync(
  "prisma/migrations/20260811170000_align_case_resolution_window/migration.sql",
  "utf8",
);
const markRoute = fs.readFileSync(
  "src/app/api/cases/[id]/mark-resolved/route.ts",
  "utf8",
);
const cronRoute = fs.readFileSync(
  "src/app/api/cron/case-auto-close/route.ts",
  "utf8",
);
const buyerPage = fs.readFileSync(
  "src/app/dashboard/orders/[id]/page.tsx",
  "utf8",
);
const sellerPage = fs.readFileSync(
  "src/app/dashboard/sales/[orderId]/page.tsx",
  "utf8",
);
const terms = fs.readFileSync("src/app/terms/page.tsx", "utf8");
const buyerHelp = fs.readFileSync(
  "src/app/help/trust-and-safety/page.tsx",
  "utf8",
);
const shippingHelp = fs.readFileSync(
  "src/app/help/shipping-and-returns/page.tsx",
  "utf8",
);
const decision = fs.readFileSync(
  "docs/case-resolution-window-decision.md",
  "utf8",
);
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const production = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);
const productionPostflight = fs.readFileSync(
  "scripts/verify-case-resolution-window-production.sql",
  "utf8",
);
const notificationMigration = fs.readFileSync(
  "prisma/migrations/20260722051500_prepare_notification_rls/migration.sql",
  "utf8",
);

describe("Case resolution-window correction", () => {
  it("replaces only the two fixed Case lifecycle operations and preserves least privilege", () => {
    assert.match(migration, /^BEGIN;/m);
    assert.match(migration, /^COMMIT;/m);
    assert.equal(
      (
        migration.match(
          /CREATE OR REPLACE FUNCTION public\.grainline_case_cron_transition_batch/g,
        ) ?? []
      ).length,
      1,
    );
    assert.equal(
      (
        migration.match(
          /CREATE OR REPLACE FUNCTION public\.grainline_case_mark_resolved/g,
        ) ?? []
      ).length,
      1,
    );
    assert.match(
      migration,
      /LANGUAGE plpgsql\s+VOLATILE\s+PARALLEL UNSAFE\s+SECURITY DEFINER\s+SET search_path = pg_catalog/,
    );
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION\s+public\.grainline_case_cron_transition_batch\(text, integer\)\s+FROM PUBLIC, grainline_app_runtime/,
    );
    assert.match(
      migration,
      /GRANT EXECUTE ON FUNCTION\s+public\.grainline_case_cron_transition_batch\(text, integer\)\s+TO grainline_app_runtime/,
    );
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION\s+public\.grainline_case_mark_resolved\(text, text\)\s+FROM PUBLIC, grainline_app_runtime/,
    );
    assert.match(
      migration,
      /GRANT EXECUTE ON FUNCTION\s+public\.grainline_case_mark_resolved\(text, text\)\s+TO grainline_app_runtime/,
    );
    assert.doesNotMatch(
      migration,
      /ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY|NO FORCE ROW LEVEL SECURITY|CREATE POLICY|EXECUTE format|dynamic SQL/i,
    );
  });

  it("derives a fresh database-only audit identity for each resolution cycle", () => {
    assert.match(
      migration,
      /audit_id_prefix :=\s+'case_resolution_mark_'\s+\|\| pg_catalog\.md5\(locked_case\.id \|\| ':' \|\| locked_actor\.id\)/,
    );
    assert.match(
      migration,
      /audit_id := audit_id_prefix \|\| ':' \|\| pg_catalog\.to_char\([\s\S]*pg_catalog\.gen_random_uuid\(\)::text[\s\S]*12\s*\)/,
    );
    assert.match(
      migration,
      /ORDER BY audit\."createdAt" DESC, audit\.id DESC\s+LIMIT 1\s+FOR SHARE/,
    );
    assert.match(migration, /audit_id := existing_audit\.id/);
    assert.match(migration, /result_action := 'replay'/);
    assert.match(
      migration,
      /pg_catalog\.substring\(\s*audit\.id,\s*pg_catalog\.char_length\(audit_id_prefix\) \+ 2\s*\)/,
    );
    assert.doesNotMatch(
      migration,
      /pg_catalog\.substring\([^)]*\bFROM\b/i,
    );
    assert.match(
      migration,
      /audit\.id = audit_id_prefix\s+OR locked_case\.status = 'RESOLVED'::public\."CaseStatus"\s+OR audit\.metadata->>'at' = pg_catalog\.to_char\(\s*locked_case\."updatedAt"/,
    );
    assert.doesNotMatch(migration, /p_audit|p_dedup|p_source_id/i);
  });

  it("selects and rechecks only buyer-initiated expired resolution windows", () => {
    assert.match(migration, /transition_at - INTERVAL '7 days'/);
    assert.match(
      migration,
      /case_row\.status = 'PENDING_CLOSE'::public\."CaseStatus"\s+AND case_row\."buyerMarkedResolved" = true\s+AND case_row\."sellerMarkedResolved" = false\s+AND case_row\."updatedAt" < transition_cutoff/,
    );
    assert.match(
      migration,
      /locked_case\."buyerMarkedResolved" IS DISTINCT FROM true\s+OR locked_case\."sellerMarkedResolved" IS DISTINCT FROM false/,
    );
    assert.match(migration, /FOR UPDATE SKIP LOCKED/);
    assert.match(migration, /target_status := 'RESOLVED'/);
    assert.match(migration, /target_resolution := 'DISMISSED'/);
    assert.match(migration, /audit_reason := 'Buyer resolution window expired'/);
    assert.match(migration, /'resolutionInitiator',[\s\S]*THEN 'buyer'/);
    assert.match(migration, /grainline_notification_create_case_event/);
  });

  it("aligns user-facing behavior and legal disclosure with the database rule", () => {
    assert.match(
      markRoute,
      /A seller-only mark never closes the buyer's\s+\/\/ Case through silence/,
    );
    assert.match(
      markRoute,
      /Confirm resolution or continue the discussion/,
    );
    assert.match(
      notificationMigration,
      /The other party marked this case resolved\. Confirm resolution or continue the discussion\./,
    );
    assert.match(buyerPage, /seller has seven days to/);
    assert.match(buyerPage, /will not close without\s+your confirmation/);
    assert.match(sellerPage, /within seven days; otherwise the case will close/);
    assert.match(sellerPage, /remain open until the buyer confirms/);
    assert.match(terms, /within <strong>7 calendar days<\/strong>/);
    assert.match(terms, /Maker&apos;s resolution mark alone does not close/);
    assert.match(buyerHelp, /maker&apos;s proposal never closes a\s+buyer&apos;s case through silence/);
    assert.match(shippingHelp, /seller-only mark cannot close the buyer&apos;s case/);
    assert.match(decision, /Seller silence never dismisses the buyer's Case/);
  });

  it("reports closures separately from non-terminal cron transitions", () => {
    assert.equal((cronRoute.match(/closed \+= rows\.length/g) ?? []).length, 1);
    assert.equal(
      (cronRoute.match(/transitioned \+= rows\.length/g) ?? []).length,
      3,
    );
    assert.match(cronRoute, /const response = \{\s+closed,\s+transitioned,/);
  });

  it("isolates the successor while sealed prefixes run and then verifies this exact phase", () => {
    assert.match(
      ci,
      /Isolate Case resolution-window release while sealed predecessors are verified[\s\S]*20260811170000_align_case_resolution_window[\s\S]*Verify CheckoutStockReservation authority migration tree[\s\S]*Restore the exact Case resolution-window release[\s\S]*Verify StripeWebhookEvent FORCE release[\s\S]*Verify the Case resolution-window release[\s\S]*SAVED_SEARCH_RLS_DEPLOY_PHASE: case-resolution-window-reviewed/,
    );
  });

  it("packages a Case-only production release without pulling queued RLS work forward", () => {
    assert.match(
      production,
      /SAVED_SEARCH_RLS_DEPLOY_PHASE: case-resolution-window-reviewed/,
    );
    assert.match(
      production,
      /Isolate queued StripeWebhookEvent FORCE from this Case-only release[\s\S]*20260810172000_force_stripe_webhook_event_rls[\s\S]*Isolate queued CheckoutStockReservation authority from this Case-only release[\s\S]*20260810190000_prepare_checkout_stock_reservation_authority[\s\S]*Apply production migrations/,
    );
    assert.match(
      production,
      /Audit final runtime grants and RLS catalog[\s\S]*verify-case-resolution-window-production\.sql/,
    );
  });

  it("postflights the exact ledger, fixed function, and Case FORCE posture read-only", () => {
    assert.match(
      productionPostflight,
      /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/,
    );
    assert.match(
      productionPostflight,
      /transaction_read_only'\) <> 'on'/,
    );
    assert.match(
      productionPostflight,
      /20260811170000_align_case_resolution_window[\s\S]*446b99fd7541efd5f1f6f768bb522cfa6254a0cb9222872bd5d76d4938dbcd03/,
    );
    assert.match(
      productionPostflight,
      /20260810172000_force_stripe_webhook_event_rls[\s\S]*20260810190000_prepare_checkout_stock_reservation_authority[\s\S]*queued_migration_count <> 0/,
    );
    assert.match(productionPostflight, /oidvectortypes\(procedure\.proargtypes\)/);
    assert.match(
      productionPostflight,
      /buyerMarkedResolved[\s\S]*sellerMarkedResolved[\s\S]*Buyer resolution window expired/,
    );
    assert.match(productionPostflight, /grainline_case_mark_resolved/);
    assert.match(productionPostflight, /audit_id_prefix/);
    assert.match(productionPostflight, /gen_random_uuid/);
    assert.match(productionPostflight, /audit_id := existing_audit/);
    assert.match(
      productionPostflight,
      /class\.relrowsecurity[\s\S]*class\.relforcerowsecurity[\s\S]*forced_table_count <> 3/,
    );
    assert.match(productionPostflight, /ROLLBACK;/);
    assert.match(
      ci,
      /Prove Case resolution-window production catalog read-only[\s\S]*verify-case-resolution-window-production\.sql/,
    );
  });
});

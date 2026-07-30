import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const migrationPath =
  "prisma/migrations/20260729060000_prepare_case_escalation_cron_authority/migration.sql";
const migration = fs.readFileSync(migrationPath, "utf8");
const escalateRoute = fs.readFileSync(
  "src/app/api/cases/[id]/escalate/route.ts",
  "utf8",
);
const cronRoute = fs.readFileSync(
  "src/app/api/cron/case-auto-close/route.ts",
  "utf8",
);
const escalationAuthority = fs.readFileSync(
  "src/lib/caseEscalationAuthority.ts",
  "utf8",
);
const cronAuthority = fs.readFileSync(
  "src/lib/caseCronTransitionAuthority.ts",
  "utf8",
);

describe("Case escalation and cron-transition authority migration", () => {
  it("keeps the preparation compatible with two exact functions and bounded due-row indexes", () => {
    assert.match(migration, /^BEGIN;/m);
    assert.match(migration, /^COMMIT;/m);
    assert.equal(
      (
        migration.match(
          /CREATE OR REPLACE FUNCTION public\.grainline_case_/g,
        ) ?? []
      ).length,
      2,
    );
    assert.doesNotMatch(
      migration,
      /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|CREATE POLICY|REVOKE (?:SELECT|INSERT|UPDATE|DELETE)/,
    );
    for (const indexName of [
      "Case_pendingCloseUpdatedAtId_idx",
      "Case_openSellerRespondById_idx",
      "Case_discussionUpdatedAtId_idx",
    ]) {
      assert.match(migration, new RegExp(`CREATE INDEX "${indexName}"`));
    }
    for (const signature of [
      "public.grainline_case_escalate(text, text)",
      "public.grainline_case_cron_transition_batch(text, integer)",
    ]) {
      const escaped = signature.replace(/[().]/g, "\\$&");
      assert.match(
        migration,
        new RegExp(`REVOKE ALL ON FUNCTION\\s+${escaped}\\s+FROM PUBLIC, grainline_app_runtime`),
      );
      assert.match(
        migration,
        new RegExp(`GRANT EXECUTE ON FUNCTION\\s+${escaped}\\s+TO grainline_app_runtime`),
      );
    }
  });

  it("derives interactive authority under stable locks and never trusts cron claims", () => {
    assert.match(
      migration,
      /CREATE OR REPLACE FUNCTION public\.grainline_case_escalate\(\s*p_actor_user_id text,\s*p_case_id text\s*\)/,
    );
    assert.match(migration, /SECURITY DEFINER\s+SET search_path = pg_catalog/);
    assert.match(migration, /FROM public\."User" AS actor[\s\S]*FOR SHARE/);
    assert.match(
      migration,
      /FROM public\."User" AS party[\s\S]*ORDER BY party\.id[\s\S]*FOR SHARE/,
    );
    assert.match(migration, /FROM public\."Order" AS orders[\s\S]*FOR UPDATE/);
    assert.match(migration, /FROM public\."Case" AS case_row[\s\S]*FOR UPDATE/);
    assert.match(
      migration,
      /locked_actor\.role IN \(\s*'EMPLOYEE'::public\."Role",\s*'ADMIN'::public\."Role"/,
    );
    assert.match(migration, /locked_case\."escalateUnlocksAt" > transition_at/);
    assert.match(migration, /counterparty_unavailable/);
    assert.match(
      migration,
      /pg_catalog\.sha256\([\s\S]*pg_catalog\.octet_length\(locked_case\.id\)[\s\S]*pg_catalog\.octet_length\(locked_actor\.id\)/,
    );
    assert.equal(
      (
        migration.match(
          /metadata->>'previousStatus' IS NULL/g,
        ) ?? []
      ).length,
      2,
    );
    assert.match(migration, /"sellerRefundLockedAt" IS NOT NULL/);
    assert.match(migration, /"caseResolutionClaimId" IS NOT NULL/);
    assert.doesNotMatch(
      migration,
      /p_(?:authorized|staff_pin|is_staff|valid_cron)|dynamic SQL|EXECUTE format/i,
    );
    assert.match(escalateRoute, /await escalateCaseWithFixedAuthority\(\{/);
    assert.doesNotMatch(
      escalateRoute,
      /verifyCronRequest|id === "all"|\bprisma\.|tx\.(?:case|caseMessage)/,
    );
    assert.match(
      escalationAuthority,
      /public\.grainline_case_escalate\(/,
    );
  });

  it("selects fixed due families, skips locked lifecycle rows, and emits atomic sources", () => {
    for (const family of [
      "PENDING_CLOSE_EXPIRED",
      "OPEN_RESPONSE_DUE",
      "STALE_DISCUSSION",
    ]) {
      assert.match(migration, new RegExp(`'${family}'`));
      assert.match(cronAuthority, new RegExp(`"${family}"`));
      assert.match(cronRoute, new RegExp(`family: "${family}"`));
    }
    assert.match(
      migration,
      /p_transition_family IS NULL[\s\S]*p_transition_family NOT IN/,
    );
    assert.match(migration, /p_limit < 1[\s\S]*p_limit > 100/);
    assert.match(migration, /transition_at - INTERVAL '7 days'/);
    assert.match(migration, /transition_at - INTERVAL '30 days'/);
    assert.match(migration, /"sellerRespondBy" < transition_cutoff/);
    assert.equal((migration.match(/UNION ALL/g) ?? []).length, 2);
    assert.equal(
      (migration.match(/FOR UPDATE SKIP LOCKED/g) ?? []).length,
      2,
    );
    assert.match(migration, /INSERT INTO public\."SystemAuditLog"/);
    assert.equal(
      (
        migration.match(
          /public\.grainline_notification_create_case_event\(/g,
        ) ?? []
      ).length,
      2,
    );
    assert.match(migration, /'case_system_action'/);
    assert.match(cronRoute, /sourceId: row\.auditLogId/);
    assert.doesNotMatch(
      cronRoute,
      /prisma\.(?:case|caseMessage)\.|logSystemActionOrThrow/,
    );
  });

  it("keeps output projections exact and validates every returned identity", () => {
    assert.match(escalationAuthority, /rows\.length !== 1/);
    assert.match(escalationAuthority, /validateCaseEscalationResult/);
    assert.match(cronAuthority, /RESULT_KEYS/);
    assert.match(cronAuthority, /UUID_V4/);
    assert.match(cronAuthority, /ids\.has\(result\.caseId\)/);
    assert.match(cronAuthority, /input\.limit > 100/);
    assert.match(
      cronAuthority,
      /public\.grainline_case_cron_transition_batch\(/,
    );
  });
});

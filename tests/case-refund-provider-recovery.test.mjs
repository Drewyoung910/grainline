import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildCaseRefundProviderRecovery,
  verifyCaseRefundProviderRecoveryBytes,
} from "../scripts/build-case-refund-provider-recovery.mjs";

const migration = readFileSync(
  "prisma/migrations/20261001070000_prepare_case_refund_provider_recovery/migration.sql",
  "utf8",
);
const authority = readFileSync(
  "src/lib/caseStaffResolutionAuthority.ts",
  "utf8",
);
const reconciliation = readFileSync(
  "src/lib/caseRefundProviderReconciliation.ts",
  "utf8",
);
const route = readFileSync(
  "src/app/api/cases/[id]/resolve/route.ts",
  "utf8",
);
const schema = readFileSync("prisma/schema.prisma", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

const runtimeFunctions = [
  "grainline_case_staff_resolution_provider_recovery_load",
  "grainline_case_staff_resolution_provider_clock",
  "grainline_case_staff_resolution_provider_recover",
  "grainline_case_staff_resolution_provider_recovery_record",
  "grainline_case_staff_resolution_recovery_finalize",
];

describe("Case refund provider recovery preparation", () => {
  it("keeps the generated migration bound to hash-pinned predecessors", () => {
    assert.equal(migration, buildCaseRefundProviderRecovery());
    const verified = verifyCaseRefundProviderRecoveryBytes();
    assert.equal(
      verified.migration,
      "20261001070000_prepare_case_refund_provider_recovery",
    );
    assert.match(verified.migrationSha256, /^[0-9a-f]{64}$/);
    assert.match(
      migration,
      /Case recovery predecessor function % drifted/,
    );
  });

  it("persists exact recovery actor, provider evidence, and lifecycle clocks", () => {
    for (const column of [
      "providerRecoveryActorId",
      "providerRecoveryAction",
      "providerRecoveryEvidenceSha256",
      "providerRecoveryInspectedAt",
      "providerRecoveryAuthorizedAt",
      "providerRecoveryRecordedAt",
      "providerRecoveryFinalizedAt",
    ]) {
      assert.match(migration, new RegExp(`"${column}"`));
      assert.match(schema, new RegExp(`\\b${column}\\b`));
    }
    assert.match(
      migration,
      /"providerRecoveryEvidenceSha256" ~ '\^\[0-9a-f\]\{64\}\$'/,
    );
    assert.match(migration, /INTERVAL '23 hours'/);
    assert.match(migration, /INTERVAL '5 minutes'/);
  });

  it("exposes only five exact runtime functions and no claim-table grant", () => {
    for (const functionName of runtimeFunctions) {
      assert.match(
        migration,
        new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${functionName}\\(`),
      );
      assert.match(
        migration,
        new RegExp(`REVOKE ALL ON FUNCTION\\s+public\\.${functionName}\\(`),
      );
    }
    assert.doesNotMatch(
      migration,
      /GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL).*CaseResolutionClaim/,
    );
    assert.match(
      migration,
      /Runtime gained direct CaseResolutionClaim authority/,
    );
  });

  it("requires an active ADMIN and preserves original resolver attribution", () => {
    assert.match(
      migration,
      /Case provider recovery requires a current ADMIN/,
    );
    assert.match(
      migration,
      /"resolvedById" = locked_claim\."staffActorId"/,
    );
    assert.match(
      migration,
      /'originalStaffActorId', locked_claim\."staffActorId"/,
    );
    assert.match(
      migration,
      /'AUTHORIZE_CASE_RESOLUTION_PROVIDER_RECOVERY'/,
    );
    assert.match(
      migration,
      /'RECOVER_CASE_RESOLUTION_PROVIDER_RECORD'/,
    );
    assert.match(
      migration,
      /'RECOVER_CASE_RESOLUTION_FINALIZE'/,
    );
    assert.match(
      migration,
      /'PROVIDER_RECORDED'::public\."CaseResolutionClaimStatus"[\s\S]*THEN transition_at[\s\S]*'RECOVER_CASE_RESOLUTION_PROVIDER_RECORD'/,
    );
  });

  it("binds the application to database clock, evidence, record, and finalize", () => {
    for (const functionName of runtimeFunctions) {
      assert.match(
        `${authority}\n${reconciliation}`,
        new RegExp(functionName),
      );
    }
    assert.match(
      reconciliation,
      /providerAuthorizedAtSeconds: Math\.floor\(authorizedAt\.getTime\(\) \/ 1000\)/,
    );
    assert.match(
      reconciliation,
      /providerEvidenceSha256: inspection\.providerEvidenceSha256/,
    );
    assert.match(
      route,
      /prepared\.status === "PROVIDER_RECORDED"[\s\S]*prepared\.action === "recovery_required"/,
    );
    assert.match(route, /CASE_REFUND_PROVIDER_RETRY_AFTER_SECONDS = 30/);
  });

  it("recovers a pending cross-admin handoff without a second provider effect", () => {
    assert.match(
      migration,
      /p_recovery_action = 'RETRY_EXISTING_SCOPE'[\s\S]*locked_claim\.status NOT IN \([\s\S]*'PROVIDER_PENDING'/,
    );
    assert.match(
      migration,
      /'action', 'recovered',[\s\S]*'providerRecoveryAction', p_recovery_action/,
    );
    assert.match(
      authority,
      /providerRecoveryAction:[\s\S]*"RETRY_EXISTING_SCOPE"[\s\S]*"RECORD_DISCOVERED_EFFECT"/,
    );
  });

  it("re-inspects recovered claims and never recreates a discovered effect", () => {
    assert.match(
      reconciliation,
      /prepared\.action === "recovered"[\s\S]*inspectCaseRefundProviderEffect/,
    );
    assert.match(
      reconciliation,
      /prepared\.providerRecoveryAction === "RECORD_DISCOVERED_EFFECT"[\s\S]*Previously discovered Case refund evidence is no longer visible/,
    );
  });

  it("isolates the candidate from historical release guards and restores it last", () => {
    const verify = ciWorkflow.indexOf(
      "Verify Case refund provider-recovery source package",
    );
    const isolate = ciWorkflow.indexOf(
      "Isolate Case refund provider recovery until historical predecessors pass",
    );
    const childEnable = ciWorkflow.indexOf(
      "Verify staged OrderItem ENABLE source package",
    );
    const historicalReceipt = ciWorkflow.indexOf(
      "Verify compatible Order checkout receipt authority release",
    );
    const restore = ciWorkflow.indexOf(
      "Restore Case refund provider recovery",
    );
    const build = ciWorkflow.indexOf("Production build");

    assert.ok(verify >= 0);
    assert.ok(verify < childEnable);
    assert.ok(childEnable < isolate);
    assert.ok(isolate < historicalReceipt);
    assert.ok(historicalReceipt < restore);
    assert.ok(restore < build);
    assert.match(
      ciWorkflow,
      /Restore Case refund provider recovery[\s\S]*Re-verify Case refund provider-recovery source package[\s\S]*Apply only Case refund provider recovery in disposable PostgreSQL[\s\S]*Audit runtime grants after Case refund provider recovery/u,
    );
  });
});

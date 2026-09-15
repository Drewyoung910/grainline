import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { inputDraftBundle } from "./order-input-correction-drafts-postgres-proof.mjs";
import { clawbackClockProofBundle } from "./order-label-clawback-clock-postgres-proof.mjs";
import { caseLifecycleProofPayload } from "./case-lifecycle-correction-postgres-proof.mjs";
import { caseLifecycleDefinitions } from "./build-case-lifecycle-correction.mjs";
import { repairOutcomeProofPayload } from "./checkout-repair-outcome-runtime-postgres-proof.mjs";
import { repairOutcomeDefinition } from "./build-checkout-reservation-repair-outcome-correction.mjs";
import { ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS, verifyOrderZeroDirectCompatiblePrefix } from "./stage-order-zero-direct-compatible-prefix.mjs";

// Proof-only manifest, NOT production migration packaging or execution authority.
// Order and Case compatibility and reservation integrity remain separate releases.
const PACKAGES = Object.freeze([
  ["order-label-outcome-correction", "b74fed4520fd27473ef5a41eebbd83b2415b1d225e96a3c75c69cd71b65143ba", "order-compatible", 2],
  ["order-refund-reconciliation-input-correction", "c127f4d90024c4a74ff74d559cf3a7fc45d76c8c3a2122890ab60b4483a39382", "order-compatible", 2],
  ["order-receipt-notification-type-correction", "8483ebb31e2bb10424fd1665fb55860ff77c6bc41034c2590859228e44843bb7", "order-compatible", 1],
  ["order-label-clawback-clock", "1a52318f26a5cb9317e6a0f9a96944e5d73717b5c5a966fed5ea41a6be28fb6d", "order-compatible", 1],
  ["case-lifecycle-correction", "1bcccaf795c84ccb9b7ee04b4c9027656d8354495e7435b6d9225cb1ca38b1db", "case-reader-first", 2],
  ["checkout-reservation-repair-outcome-correction", "1bc38379f558c1b4223bf1d95c6694ac20571be1a56683f102fa37ccbb4d2c73", "reservation-integrity-separate", 1],
].map((entry) => Object.freeze(entry)));

const digest = (value) => createHash("sha256").update(value).digest("hex");

export function correctionCompositionBundle() {
  verifyOrderZeroDirectCompatiblePrefix({ write: false });
  const bundle = [
    ...inputDraftBundle(),
    { ...clawbackClockProofBundle()[0], name: "order-label-clawback-clock",
      definitions: clawbackClockProofBundle()[0].definitions.map((def) => ({ ...def, args: "integer" })) },
    { name: "case-lifecycle-correction", payload: caseLifecycleProofPayload(), definitions: caseLifecycleDefinitions() },
    { name: "checkout-reservation-repair-outcome-correction", payload: repairOutcomeProofPayload(), definitions: [repairOutcomeDefinition()] },
  ];
  const names = new Set();
  return bundle.map((entry, index) => {
    const [name, sha256, boundary, count] = PACKAGES[index];
    assert.equal(entry.name, name);
    assert.equal(digest(readFileSync(`docs/rls-drafts/${name}.sql`)), sha256, `${name} reviewed bytes drifted`);
    assert.equal(entry.definitions.length, count);
    assert.doesNotMatch(entry.payload, /^(?:BEGIN|COMMIT|ROLLBACK);$/mu);
    const definitions = entry.definitions.map((definition) => {
      assert.ok(!names.has(definition.name), "overlapping correction targets");
      assert.equal(typeof definition.args, "string", "missing exact function identity");
      names.add(definition.name);
      return { ...definition,
        runtimeExecute: definition.runtimeExecute ?? true,
      };
    });
    return { ...entry, sha256, boundary, definitions };
  });
}

export function correctionCompositionManifest() {
  return {
    scope: "disposable-composition-only", productionExecutionAuthorized: false,
    prefix: ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS.map(({ migration, sha256 }) => ({ migration, sha256 })),
    packages: correctionCompositionBundle().map(({ name, sha256, boundary, definitions }) => ({
      name, sha256, boundary,
      functions: definitions.map(({ name: functionName, args, runtimeExecute, tag, before, after }) => ({
        name: functionName, args, runtimeExecute,
        beforeBodySha256: digest(before.split(tag)[1]), afterBodySha256: digest(after.split(tag)[1]),
      })),
    })),
    unchanged: ["signatures", "owners", "ACLs", "roles", "memberships", "schema", "constraints", "triggers", "indexes", "policies", "RLS", "migration-ledger"],
    releaseDependencies: ["Case-compatible-readers-before-lifecycle-SQL", "label-clock-SQL-before-automatic-retry-acceptance", "reservation-integrity-separately-packaged"],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(correctionCompositionManifest(), null, 2)}\n`);
}

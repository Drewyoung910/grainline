import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION,
  ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION_SHA256,
  verifyOrderParticipantListProjectionCorrectionBytes,
} from "../scripts/order-participant-list-projection-correction-catalog.mjs";

test("Order participant list projection correction is reproducible and byte-pinned", () => {
  const { migration, migrationSha256 } =
    verifyOrderParticipantListProjectionCorrectionBytes();
  assert.equal(
    ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION,
    "20260901155000_correct_order_participant_list_projection",
  );
  assert.equal(
    migrationSha256,
    ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION_SHA256,
  );
  assert.equal(
    (migration.match(/CREATE OR REPLACE FUNCTION public\.grainline_order_/gu) ?? [])
      .length,
    2,
  );
  assert.equal((migration.match(/SECURITY DEFINER/gu) ?? []).length, 2);
  assert.equal((migration.match(/SET search_path = pg_catalog/gu) ?? []).length, 2);
});

test("correction derives exact text projections without widening authority", () => {
  const { migration } = verifyOrderParticipantListProjectionCorrectionBytes();
  assert.match(
    migration,
    /source_order\."shippingTitle"::text/,
  );
  assert.match(migration, /source_order\."buyerName"::text/);
  assert.match(migration, /source_order\."buyerEmail"::text/);
  assert.equal(
    (migration.match(/source_order\."shippingTitle"::text/gu) ?? []).length,
    2,
  );
  assert.doesNotMatch(
    migration,
    /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|ALTER TABLE|GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u,
  );
  assert.doesNotMatch(migration, /\b(?:INSERT INTO|UPDATE public\.|DELETE FROM)\b/u);
  for (const name of [
    "grainline_order_buyer_page",
    "grainline_order_seller_page",
  ]) {
    const identity = `public.${name}(\n  text, integer, bigint, text\n)`;
    assert.ok(
      migration.includes(
        `REVOKE ALL ON FUNCTION ${identity} FROM PUBLIC, grainline_app_runtime;`,
      ),
    );
    assert.ok(
      migration.includes(
        `GRANT EXECUTE ON FUNCTION ${identity} TO grainline_app_runtime;`,
      ),
    );
  }
});

test("CI isolates the correction from historical gates and restores it last", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const verify = workflow.indexOf(
    "Verify Order participant list projection correction",
  );
  const isolate = workflow.indexOf(
    "Isolate Order participant list projection correction until charged total passes",
  );
  const chargedVerify = workflow.indexOf(
    "Verify compatible Order charged-total witness",
  );
  const chargedRestore = workflow.indexOf(
    "Restore compatible Order charged-total witness",
  );
  const correctionRestore = workflow.indexOf(
    "Restore Order participant list projection correction",
  );
  const compatibleApply = workflow.indexOf(
    "Apply compatible Order participant authority",
  );
  assert.ok(
    verify >= 0
      && verify < isolate
      && isolate < chargedVerify
      && chargedRestore < correctionRestore
      && correctionRestore < compatibleApply,
  );
});

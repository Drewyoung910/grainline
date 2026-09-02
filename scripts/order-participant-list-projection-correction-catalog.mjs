import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildOrderParticipantListProjectionCorrection,
} from "./build-order-participant-list-projection-correction.mjs";

export const ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION =
  "20260901155000_correct_order_participant_list_projection";
export const ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION_SHA256 =
  "49d1ec44006993e3730155d4d076854837b81f3b83854f072c48e566817d3e04";

export function verifyOrderParticipantListProjectionCorrectionBytes(
  root = process.cwd(),
) {
  const migration = readFileSync(
    path.join(
      root,
      "prisma",
      "migrations",
      ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION,
      "migration.sql",
    ),
    "utf8",
  );
  assert.equal(
    migration,
    buildOrderParticipantListProjectionCorrection(root),
    "Order participant list projection correction is not reproducible",
  );
  const migrationSha256 = createHash("sha256")
    .update(migration)
    .digest("hex");
  assert.equal(
    migrationSha256,
    ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION_SHA256,
    "Order participant list projection correction bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

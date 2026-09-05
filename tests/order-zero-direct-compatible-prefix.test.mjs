import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS,
  ORDER_ZERO_DIRECT_COMPATIBLE_PHASE,
  ORDER_ZERO_DIRECT_COMPATIBLE_SUCCESSOR_MIGRATIONS,
  appendReviewedOrderZeroDirectCompatibleSuccessors,
  verifyOrderZeroDirectCompatiblePrefix,
} from "../scripts/stage-order-zero-direct-compatible-prefix.mjs";

const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grainline-order-prefix-"));
  temporaryRoots.push(root);
  for (const member of ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS) {
    if (member.draft) {
      const source = path.join("docs", "rls-drafts", member.draft);
      const target = path.join(root, source);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    } else {
      const source = path.join(
        "prisma", "migrations", member.migration, "migration.sql",
      );
      const target = path.join(root, source);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Order zero-direct compatible prefix staging", () => {
  it("generates and verifies exactly fourteen byte-identical draft migrations", () => {
    const root = temporaryRoot();
    const result = verifyOrderZeroDirectCompatiblePrefix({ root, write: true });
    assert.deepEqual(result, {
      phase: ORDER_ZERO_DIRECT_COMPATIBLE_PHASE,
      memberCount: 16,
      generatedMemberCount: 14,
      firstMigration: "20260905010000_correct_order_staff_read_charged_total",
      lastMigration: "20260905160000_prepare_order_checkout_refund_review_authority",
    });
    for (const member of ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS) {
      if (!member.draft) continue;
      assert.deepEqual(
        fs.readFileSync(path.join(
          root, "prisma", "migrations", member.migration, "migration.sql",
        )),
        fs.readFileSync(path.join(root, "docs", "rls-drafts", member.draft)),
        member.migration,
      );
    }
  });

  it("fails closed on source drift, migration drift, and unknown in-range rows", () => {
    const sourceDriftRoot = temporaryRoot();
    const sourceMember = ORDER_ZERO_DIRECT_COMPATIBLE_MEMBERS.find(
      (member) => member.draft,
    );
    fs.appendFileSync(
      path.join(sourceDriftRoot, "docs", "rls-drafts", sourceMember.draft),
      "\n-- drift\n",
    );
    assert.throws(
      () => verifyOrderZeroDirectCompatiblePrefix({ root: sourceDriftRoot, write: true }),
      /draft .* checksum drift/,
    );

    const migrationDriftRoot = temporaryRoot();
    verifyOrderZeroDirectCompatiblePrefix({ root: migrationDriftRoot, write: true });
    fs.appendFileSync(
      path.join(
        migrationDriftRoot,
        "prisma", "migrations", sourceMember.migration, "migration.sql",
      ),
      "\n-- drift\n",
    );
    assert.throws(
      () => verifyOrderZeroDirectCompatiblePrefix({ root: migrationDriftRoot }),
      /migration .* checksum drift/,
    );

    const unknownRoot = temporaryRoot();
    verifyOrderZeroDirectCompatiblePrefix({ root: unknownRoot, write: true });
    fs.mkdirSync(path.join(
      unknownRoot,
      "prisma", "migrations", "20260905035000_unknown_order_member",
    ));
    assert.throws(
      () => verifyOrderZeroDirectCompatiblePrefix({ root: unknownRoot }),
      /migration range is not exact/,
    );
  });

  it("appends only the complete byte-verified successor suffix", () => {
    const root = temporaryRoot();
    verifyOrderZeroDirectCompatiblePrefix({ root, write: true });
    const reviewedSuccessors = [
      "20260905020000_prepare_order_account_deletion_authority",
    ];
    assert.equal(
      appendReviewedOrderZeroDirectCompatibleSuccessors({
        root,
        laterMigrations: ORDER_ZERO_DIRECT_COMPATIBLE_SUCCESSOR_MIGRATIONS,
        reviewedSuccessors,
        expectedPredecessor:
          "20260905020000_prepare_order_account_deletion_authority",
      }),
      true,
    );
    assert.deepEqual(reviewedSuccessors.slice(1), [
      ...ORDER_ZERO_DIRECT_COMPATIBLE_SUCCESSOR_MIGRATIONS,
    ]);

    assert.throws(
      () => appendReviewedOrderZeroDirectCompatibleSuccessors({
        root,
        laterMigrations: ORDER_ZERO_DIRECT_COMPATIBLE_SUCCESSOR_MIGRATIONS.slice(0, -1),
        reviewedSuccessors: [
          "20260905020000_prepare_order_account_deletion_authority",
        ],
        expectedPredecessor:
          "20260905020000_prepare_order_account_deletion_authority",
      }),
      /must be complete and ordered/,
    );
    assert.throws(
      () => appendReviewedOrderZeroDirectCompatibleSuccessors({
        root,
        laterMigrations: ORDER_ZERO_DIRECT_COMPATIBLE_SUCCESSOR_MIGRATIONS,
        reviewedSuccessors: ["wrong-predecessor"],
        expectedPredecessor:
          "20260905020000_prepare_order_account_deletion_authority",
      }),
      /exact reviewed predecessor/,
    );
  });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { auditUserIndirectAccess } from "../scripts/audit-user-indirect-access.mjs";

const REVIEWED_FACTORY_CALL = /^(?:publicListingWhere|publicListingDetailWhere|activeSellerProfileWhere|visibleSellerProfileWhere|openCommissionWhere|openCommissionMutationWhere|publicBlogPostWhere|ownerCartWhere|ownerCartItemWhere|ownerSavedBlogPostWhere|visibleBlogCommentWhere|accountEmailOutboxWhere|sellerBroadcastOutboxCancellationWhere)\(/;

function canonicalShape(shape) {
  const query = shape.query ?? shape.definition ?? shape;
  return [
    query.file,
    shape.model ?? "",
    shape.path ?? "",
    shape.function ?? "",
    shape.expression.replace(/\s+/g, " ").trim(),
  ].join("|");
}

function digest(shapes) {
  const signatures = [...new Set(shapes.map(canonicalShape))].sort();
  return {
    unique: signatures.length,
    sha256: createHash("sha256").update(signatures.join("\n")).digest("hex"),
  };
}

test("the manually reviewed opaque User-query frontier is immutable", () => {
  const report = auditUserIndirectAccess(process.cwd());
  assert.equal(report.directCount, 0);
  assert.equal(report.relationCount, 0);
  assert.equal(report.rawSqlCount, 0);
  assert.deepEqual(report.factoryRelations, []);

  const reviewedFactories = report.opaqueShapes.filter((shape) => REVIEWED_FACTORY_CALL.test(shape.expression.trim()));
  const reviewedResidual = report.opaqueShapes.filter((shape) => !REVIEWED_FACTORY_CALL.test(shape.expression.trim()));

  // UserReport target validation moves three remaining report-route factory
  // calls behind one actor-bound SQL authority.
  assert.equal(report.opaqueShapes.length, 143);
  assert.equal(reviewedFactories.length, 108);
  assert.equal(reviewedResidual.length, 35);
  assert.equal(report.opaqueFactoryShapes.length, 11);
  assert.deepEqual(digest(reviewedFactories), {
    unique: 87,
    sha256: "eb75a11ac24bbf81ac24e1d1a4b41c8bd65a554d2059ede9d75dc454fbbc4996",
  });
  assert.deepEqual(digest(reviewedResidual), {
    unique: 29,
    sha256: "34ab3fdcdd1d88f8f02b8670b9c41065b017808d5dcdccd5cdac0e58ce8eb456",
  });
  assert.deepEqual(digest(report.opaqueFactoryShapes), {
    unique: 11,
    sha256: "ebc70a765e572ac13d5ab93e07298cd292a18de2498f297fec6e1bbc8195402b",
  });
});

test("reviewed shared filters use scalar ownership and lifecycle snapshots instead of User relations", () => {
  const listing = readFileSync("src/lib/listingVisibility.ts", "utf8");
  const seller = readFileSync("src/lib/sellerVisibility.ts", "utf8");
  const blog = readFileSync("src/lib/blogVisibility.ts", "utf8");
  const commission = readFileSync("src/lib/commissionState.ts", "utf8");
  const cart = readFileSync("src/lib/cartOwnerAccess.ts", "utf8");
  const savedBlog = readFileSync("src/lib/savedBlogPostOwnerAccess.ts", "utf8");
  const sellerPublicMirrors = readFileSync(
    "prisma/migrations/20261020235989_prepare_seller_profile_public_visibility_mirrors/migration.sql",
    "utf8",
  );

  for (const source of [listing, seller, blog]) {
    assert.doesNotMatch(source, /\buser:\s*\{/);
  }
  assert.match(listing, /sellerPubliclyOrderable: true/);
  assert.match(seller, /ownerAccountActive: true/);
  assert.match(
    sellerPublicMirrors,
    /"sellerPubliclyOrderable" = \([\s\S]*seller\."chargesEnabled" = true[\s\S]*seller\."stripeAccountSupported" = true[\s\S]*seller\."vacationMode" = false[\s\S]*seller\."ownerAccountActive" = true/,
  );
  assert.match(blog, /authorAccountActive: true/);
  assert.match(blog, /authorSellerPubliclyOrderable: true/);
  assert.match(commission, /buyerAccountActive: true/);
  assert.match(cart, /\{ cart: \{ userId \} \}/);
  assert.match(savedBlog, /return \{ AND: \[\{ userId \}, where\] \}/);
});

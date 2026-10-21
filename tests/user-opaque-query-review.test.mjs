import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { auditUserIndirectAccess } from "../scripts/audit-user-indirect-access.mjs";

const REVIEWED_FACTORY_CALL = /^(?:publicListingWhere|publicListingDetailWhere|activeSellerProfileWhere|visibleSellerProfileWhere|openCommissionWhere|openCommissionMutationWhere|publicBlogPostWhere|ownerCartWhere|ownerCartItemWhere|ownerSavedBlogPostWhere|savedListingFavoriteWhere|visibleBlogCommentWhere|publicCommissionInterestWhere)\(/;

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

  assert.equal(report.opaqueShapes.length, 165);
  assert.equal(reviewedFactories.length, 133);
  assert.equal(reviewedResidual.length, 32);
  assert.equal(report.opaqueFactoryShapes.length, 12);
  assert.deepEqual(digest(reviewedFactories), {
    unique: 109,
    sha256: "0a1a5f0ad484077f6067c9cb049f6d3296a14643130edf6df43a31798c03272e",
  });
  assert.deepEqual(digest(reviewedResidual), {
    unique: 26,
    sha256: "146652b837c49d7da2e0486fdc4833683617411abb29e74edb726b276a4e254f",
  });
  assert.deepEqual(digest(report.opaqueFactoryShapes), {
    unique: 12,
    sha256: "8be152475784c708b5045963749df829459dc7da639b6bcaec5bfeccc6ee64a2",
  });
});

test("reviewed shared filters use scalar ownership and lifecycle snapshots instead of User relations", () => {
  const listing = readFileSync("src/lib/listingVisibility.ts", "utf8");
  const seller = readFileSync("src/lib/sellerVisibility.ts", "utf8");
  const blog = readFileSync("src/lib/blogVisibility.ts", "utf8");
  const commission = readFileSync("src/lib/commissionState.ts", "utf8");
  const interests = readFileSync("src/lib/commissionInterestCount.ts", "utf8");
  const cart = readFileSync("src/lib/cartOwnerAccess.ts", "utf8");
  const savedBlog = readFileSync("src/lib/savedBlogPostOwnerAccess.ts", "utf8");
  const savedListing = readFileSync("src/lib/savedListingVisibility.ts", "utf8");

  for (const source of [listing, seller, blog, interests, savedListing]) {
    assert.match(source, /ownerAccountActive: true/);
    assert.doesNotMatch(source, /\buser:\s*\{/);
  }
  assert.match(blog, /authorAccountActive: true/);
  assert.match(commission, /buyerAccountActive: true/);
  assert.match(cart, /\{ cart: \{ userId \} \}/);
  assert.match(savedBlog, /return \{ AND: \[\{ userId \}, where\] \}/);
  assert.match(savedListing, /return \{[\s\S]*userId,[\s\S]*listing:/);
});

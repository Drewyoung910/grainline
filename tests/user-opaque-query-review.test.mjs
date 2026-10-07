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

  assert.equal(report.opaqueShapes.length, 222);
  assert.equal(reviewedFactories.length, 185);
  assert.equal(reviewedResidual.length, 37);
  assert.equal(report.opaqueFactoryShapes.length, 14);
  assert.deepEqual(digest(reviewedFactories), {
    unique: 152,
    sha256: "a2d6479ba3a3502e7c59181008c4a65aaf577d67702a7c9bf402ef7543fe4662",
  });
  assert.deepEqual(digest(reviewedResidual), {
    unique: 31,
    sha256: "0c4d214c9910a122bae2ae21d1b498cafb88388ff3c4d9543afb603f6586f54a",
  });
  assert.deepEqual(digest(report.opaqueFactoryShapes), {
    unique: 14,
    sha256: "2724052b30cfc98d6792b944c1dc8458a08550e0107b8ada2e67c1185f5fe9b7",
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

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

  // The provider/eligibility fence replaces three direct Prisma
  // EmailSuppression write arguments with one fixed SQL authority. The
  // StockNotification subscribe authority also removes one reviewed
  // publicListingDetailWhere call from the application frontier.
  // Listing preparation removes the reviewed public/owner Listing factories
  // and residual write shapes from application code. Their behavior is now
  // pinned by the fixed Listing authority proofs. No User relation or raw
  // table authority is added.
  // C-1882 removed generateStaticParams from the metro browse, metro
  // category and commission metro pages, deleting seven reviewed
  // publicListingWhere/openCommissionWhere build-time reads. C-261 then added
  // three reviewed factory reads to metadata (empty metro and category pages
  // return 404 or noindex), and C-1890 removed the tag-word spread residual.
  // UserReport validation moves three public target factories behind its
  // actor-bound SQL authority.
  // Email-service least privilege removes eight more app-side query shapes
  // by moving their bounded behavior behind fixed SQL authorities.
  // Commission preparation removes fifteen reviewed app-side factory calls
  // while AdminAuditLog preparation moves the deletion selector and retry
  // payload behind fixed authorities.
  assert.equal(report.opaqueShapes.length, 79);
  assert.equal(reviewedFactories.length, 62);
  assert.equal(reviewedResidual.length, 17);
  assert.equal(report.opaqueFactoryShapes.length, 11);
  assert.deepEqual(digest(reviewedFactories), {
    unique: 49,
    sha256: "929ba84690aa8088780b7996ce397b4a04ee4970d6e11b8fac2eabf65878e4a7",
  });
  assert.deepEqual(digest(reviewedResidual), {
    unique: 12,
    sha256: "8f01f1ef708c8b2d40e5cab6f7985d29155df5e1812e8512d993507f2e89bc28",
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

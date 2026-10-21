import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditModelIndirectAccess } from "./audit-user-indirect-access.mjs";

export const SELLER_PROFILE_PUBLIC_CONTRACTS = Object.freeze({
  PUBLIC_PROFILE: "Public-safe seller presentation under the caller's existing visibility predicate.",
  PUBLIC_ELIGIBILITY: "Boolean, count, or filter-only seller availability without returning a seller row.",
  PUBLIC_MAP: "Approximate public point only for an active, opted-in seller with no positive privacy radius.",
  OWNER: "Authenticated active owner access to that owner's profile and settings.",
  PARTICIPANT: "Authenticated relationship-bound access for follows, saves, reports, reviews, or messages.",
  STAFF: "Named staff operation retaining role, PIN, target, state-transition, and audit requirements.",
  SERVICE: "Named webhook, cron, deletion, notification, metrics, repair, or telemetry operation.",
  TRANSACTION: "Checkout, shipping, listing, or custom-order operation bound to its actor and resource.",
});

// This is the exact current source-consumer disposition, not the future SQL API.
// A file can need several contracts when it combines public presentation with
// contextual eligibility, approximate-map, participant, or transaction behavior.
export const SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS = Object.freeze({
  "src/app/admin/broadcasts/page.tsx": ["STAFF"],
  "src/app/admin/verification/page.tsx": ["STAFF"],
  "src/app/api/admin/listings/[id]/review/route.ts": ["STAFF"],
  "src/app/api/cart/add/route.ts": ["TRANSACTION"],
  "src/app/api/cart/update/route.ts": ["TRANSACTION"],
  "src/app/api/listings/[id]/similar/route.ts": ["PUBLIC_ELIGIBILITY"],
  "src/app/api/listings/[id]/stock/route.ts": ["TRANSACTION"],
  "src/app/api/reviews/[id]/vote/route.ts": ["PUBLIC_ELIGIBILITY", "PARTICIPANT"],
  "src/app/api/reviews/route.ts": ["PUBLIC_PROFILE", "PUBLIC_ELIGIBILITY", "PARTICIPANT"],
  "src/app/api/shipping/quote/route.ts": ["TRANSACTION"],
  "src/app/api/users/[id]/report/route.ts": ["PUBLIC_ELIGIBILITY", "PARTICIPANT"],
  "src/app/browse/page.tsx": ["PUBLIC_PROFILE", "PUBLIC_ELIGIBILITY"],
  "src/app/listing/[id]/page.tsx": ["PUBLIC_PROFILE", "PUBLIC_ELIGIBILITY", "PUBLIC_MAP", "PARTICIPANT"],
  "src/app/messages/[id]/page.tsx": ["PARTICIPANT", "TRANSACTION"],
  "src/app/messages/new/page.tsx": ["PARTICIPANT", "TRANSACTION"],
  "src/lib/cartOwnerAccess.ts": ["TRANSACTION"],
  "src/lib/listingDelete.ts": ["OWNER", "TRANSACTION"],
  "src/lib/quality-score.ts": ["SERVICE"],
  "src/lib/sellerCheckoutPrivateAccess.ts": ["TRANSACTION"],
});

const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

const REVIEWED_TARGET_PREDICATE_CALLS = new Set([
  "activeSellerProfileWhere",
  "baseWhere",
  "visibleSellerProfileWhere",
]);

const REVIEWED_NON_TARGET_QUERY_FACTORIES = new Set([
  "accountDeletionBlogPostMediaOwnerWhere",
  "claimableAccountDeletionSideEffectWhere",
  "openCommissionMutationWhere",
  "openCommissionWhere",
  "ownerCartItemWhere",
  "ownerCartWhere",
  "ownerSavedBlogPostWhere",
  "ownerSavedSearchWhere",
  "publicBlogPostWhere",
  "publicListingDetailWhere",
  "publicListingWhere",
  "supportRequestAccountExportWhere",
  "timestampCursorWhere",
  "viewerBlogPostWhere",
  "visibleBlogCommentWhere",
]);

const REVIEWED_FACTORY_FUNCTIONS = new Set([
  "openCommissionMutationWhere",
  "openCommissionWhere",
  "ownerCartItemWhere",
  "ownerCartWhere",
  "ownerSavedBlogPostWhere",
  "publicBlogPostWhere",
  "publicListingDetailWhere",
  "publicListingWhere",
]);

function expressionHead(expression) {
  return /^([\w$.]+)/u.exec(expression.replace(/\s+/gu, " ").trim())?.[1] ?? "";
}

function sorted(values) {
  return [...values].sort();
}

export function verifySellerProfilePublicConsumerContracts(root) {
  const audit = auditModelIndirectAccess(root, "SellerProfile");
  const currentFiles = new Set([
    ...audit.direct.map(({ file }) => file),
    ...audit.relations.map(({ query }) => query.file),
    ...audit.rawSql.map(({ file }) => file),
  ]);
  const manifestFiles = new Set(Object.keys(SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS));
  const missing = sorted([...currentFiles].filter((file) => !manifestFiles.has(file)));
  const stale = sorted([...manifestFiles].filter((file) => !currentFiles.has(file)));
  if (missing.length || stale.length) {
    throw new Error(`SellerProfile consumer manifest drifted: missing=${missing.join(",") || "none"}; stale=${stale.join(",") || "none"}`);
  }

  const knownContracts = new Set(Object.keys(SELLER_PROFILE_PUBLIC_CONTRACTS));
  for (const [file, contracts] of Object.entries(SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS)) {
    if (!Array.isArray(contracts) || contracts.length === 0) {
      throw new Error(`${file} has no SellerProfile authority contract`);
    }
    if (new Set(contracts).size !== contracts.length) {
      throw new Error(`${file} repeats a SellerProfile authority contract`);
    }
    for (const contract of contracts) {
      if (!knownContracts.has(contract)) throw new Error(`${file} has unknown contract ${contract}`);
    }
  }

  const directWrites = audit.direct.filter(({ method }) => WRITE_METHODS.has(method));
  for (const write of directWrites) {
    const contracts = SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS[write.file];
    if (!contracts.some((contract) => ["OWNER", "STAFF", "SERVICE"].includes(contract))) {
      throw new Error(`${write.file}:${write.line} direct ${write.method} lacks an owner, staff, or service contract`);
    }
  }

  const coordinateFiles = new Set([
    ...audit.direct
      .filter(({ fields }) => fields.includes("lat") || fields.includes("lng"))
      .map(({ file }) => file),
    ...audit.relations
      .filter(({ fields }) => fields.includes("lat") || fields.includes("lng"))
      .map(({ query }) => query.file),
  ]);
  for (const file of coordinateFiles) {
    const contracts = SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS[file];
    if (!contracts.includes("OWNER") && !contracts.includes("PUBLIC_MAP")) {
      throw new Error(`${file} reads SellerProfile coordinates without OWNER or PUBLIC_MAP`);
    }
  }

  const contractCounts = Object.fromEntries(
    Object.keys(SELLER_PROFILE_PUBLIC_CONTRACTS).map((contract) => [
      contract,
      Object.values(SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS)
        .filter((contracts) => contracts.includes(contract)).length,
    ]),
  );

  const targetOpaqueShapes = audit.opaqueShapes.filter(({ model }) => model === "SellerProfile");
  const unknownTargetOpaqueShapes = targetOpaqueShapes.filter(
    ({ expression }) => !REVIEWED_TARGET_PREDICATE_CALLS.has(expressionHead(expression)),
  );
  if (unknownTargetOpaqueShapes.length) {
    throw new Error(`Unreviewed SellerProfile query shapes: ${JSON.stringify(unknownTargetOpaqueShapes)}`);
  }
  const nonTargetOpaqueShapes = audit.opaqueShapes.filter(({ model }) => model !== "SellerProfile");
  const reviewedNonTargetFactoryCalls = nonTargetOpaqueShapes.filter(
    ({ expression }) => REVIEWED_NON_TARGET_QUERY_FACTORIES.has(expressionHead(expression)),
  );
  const reviewedNonTargetResiduals = nonTargetOpaqueShapes.filter(
    ({ expression }) => !REVIEWED_NON_TARGET_QUERY_FACTORIES.has(expressionHead(expression)),
  );
  if (reviewedNonTargetResiduals.some(({ model }) => model === "SellerProfile")) {
    throw new Error("A residual opaque shape unexpectedly targets SellerProfile");
  }
  if (targetOpaqueShapes.length !== 0
      || reviewedNonTargetFactoryCalls.length !== 119
      || reviewedNonTargetResiduals.length !== 22) {
    throw new Error(
      `SellerProfile opaque-shape review drifted: target=${targetOpaqueShapes.length}; `
      + `factoryCalls=${reviewedNonTargetFactoryCalls.length}; residuals=${reviewedNonTargetResiduals.length}`,
    );
  }
  const unknownOpaqueFactories = audit.opaqueFactoryShapes.filter(
    ({ function: functionName }) => !REVIEWED_FACTORY_FUNCTIONS.has(functionName),
  );
  if (unknownOpaqueFactories.length || audit.opaqueFactoryShapes.length !== 11) {
    throw new Error(`SellerProfile typed factory review drifted: ${JSON.stringify(unknownOpaqueFactories)}`);
  }
  return {
    consumerFiles: currentFiles.size,
    directWrites: directWrites.length,
    coordinateFiles: coordinateFiles.size,
    reviewedOpaqueShapes: audit.opaqueShapes.length,
    reviewedOpaqueFactoryShapes: audit.opaqueFactoryShapes.length,
    opaqueTargetPredicates: targetOpaqueShapes.length,
    opaqueNonTargetFactoryCalls: reviewedNonTargetFactoryCalls.length,
    opaqueNonTargetResiduals: reviewedNonTargetResiduals.length,
    contractCounts,
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.stdout.write(`${JSON.stringify(verifySellerProfilePublicConsumerContracts(root), null, 2)}\n`);
}

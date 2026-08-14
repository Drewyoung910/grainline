// CHECKOUT_STOCK_RESERVATION_PROVIDER_RUNNER_ONLY
// This module is imported only by the disposable Preview proof route. The
// production release guard rejects any tree that still contains that route.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db.ts";
import {
  abortCheckoutStockReservation,
  createSingleCheckoutStockReservation,
  exportCheckoutStockReservations,
  lockCheckoutReservationSellerSource,
  type CheckoutReservationCreation,
} from "./checkoutStockReservationAuthority.ts";
import {
  checkoutReservationInventorySourceMatches,
  CheckoutReservationSourceChangedError,
  singleCheckoutReservationSourceSignature,
} from "./checkoutReservationSourceState.ts";
import {
  CHECKOUT_RESERVATION_PROVIDER_FIXTURE_COUNT,
  CHECKOUT_RESERVATION_PROVIDER_FIXTURE_PREFIX,
  checkoutReservationProviderFixture,
  parseCheckoutStockReservationProviderGateConfig,
  type CheckoutReservationProviderGateConfig,
} from "./checkoutStockReservationProviderConfig.ts";

export {
  CHECKOUT_RESERVATION_PROVIDER_FIXTURE_COUNT,
  CHECKOUT_RESERVATION_PROVIDER_FIXTURE_PREFIX,
  checkoutReservationProviderFixture,
  parseCheckoutStockReservationProviderGateConfig,
};

type WorkloadResult = Readonly<{
  concurrency: number;
  errorCount: number;
  label: string;
  maxMs: number;
  meanMs: number;
  p95Ms: number;
  requests: number;
}>;

type SourceReadClient = Pick<Prisma.TransactionClient, "listing">;

type SourceListing = NonNullable<Awaited<ReturnType<typeof readFixtureListing>>>;

function payloadHash(runSlot: 1 | 2, label: string, requestIndex: number) {
  return createHash("sha256")
    .update(`${CHECKOUT_RESERVATION_PROVIDER_FIXTURE_PREFIX}:${runSlot}:${label}:${requestIndex}`)
    .digest("base64url")
    .slice(0, 32);
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

function percentile95(values: readonly number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

async function measureWorkload(
  label: string,
  requests: number,
  concurrency: number,
  operation: (requestIndex: number) => Promise<void>,
): Promise<WorkloadResult> {
  const durations: number[] = [];
  let errorCount = 0;
  let nextRequest = 0;
  const workers = Array.from({ length: Math.min(requests, concurrency) }, async () => {
    for (;;) {
      const requestIndex = nextRequest;
      nextRequest += 1;
      if (requestIndex >= requests) return;
      const startedAt = performance.now();
      try {
        await operation(requestIndex);
      } catch {
        errorCount += 1;
      } finally {
        durations.push(performance.now() - startedAt);
      }
    }
  });
  await Promise.all(workers);
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  return Object.freeze({
    concurrency,
    errorCount,
    label,
    maxMs: rounded(Math.max(...durations, 0)),
    meanMs: rounded(total / Math.max(durations.length, 1)),
    p95Ms: rounded(percentile95(durations)),
    requests,
  });
}

async function readFixtureListing(
  listingId: string,
  client: SourceReadClient = prisma,
) {
  return client.listing.findUnique({
    where: { id: listingId },
    include: {
      photos: { orderBy: { sortOrder: "asc" as const } },
      seller: {
        select: {
          id: true,
          userId: true,
          displayName: true,
          stripeAccountId: true,
          stripeAccountVersion: true,
          chargesEnabled: true,
          vacationMode: true,
          acceptingNewOrders: true,
          allowLocalPickup: true,
          offersGiftWrapping: true,
          giftWrappingPriceCents: true,
          defaultPkgWeightGrams: true,
          defaultPkgLengthCm: true,
          defaultPkgWidthCm: true,
          defaultPkgHeightCm: true,
          user: { select: { banned: true, deletedAt: true } },
        },
      },
      variantGroups: { include: { options: true } },
    },
  });
}

function pricedSignature(buyerId: string, listing: SourceListing) {
  const signature = singleCheckoutReservationSourceSignature(
    buyerId,
    listing,
    1,
    [listing.variantGroups[0]!.options[0]!.id],
  );
  if (!signature) throw new Error("provider fixture source is unavailable");
  return signature;
}

async function restoreFixtureReservation(
  creation: CheckoutReservationCreation,
  buyerId: string,
  sourcePayloadHash: string,
) {
  const restored = await abortCheckoutStockReservation({
    reservationId: creation.id,
    buyerId,
    payloadHash: sourcePayloadHash,
  });
  if (restored.result !== "restored") {
    throw new Error("provider fixture reservation was not restored");
  }
}

async function runBaseline(runSlot: 1 | 2, label: string, requestIndex: number) {
  const fixture = checkoutReservationProviderFixture(
    runSlot,
    requestIndex % CHECKOUT_RESERVATION_PROVIDER_FIXTURE_COUNT,
  );
  const listing = await readFixtureListing(fixture.listingId);
  if (!listing || !pricedSignature(fixture.buyerId, listing)) {
    throw new Error("provider baseline fixture is unavailable");
  }
  const sourcePayloadHash = payloadHash(runSlot, label, requestIndex);
  const creation = await createSingleCheckoutStockReservation({
    buyerId: fixture.buyerId,
    listingId: fixture.listingId,
    payloadHash: sourcePayloadHash,
    quantity: 1,
  });
  if (!creation) throw new Error("provider baseline returned no reservation");
  await restoreFixtureReservation(creation, fixture.buyerId, sourcePayloadHash);
}

async function runCandidate(
  runSlot: 1 | 2,
  label: string,
  requestIndex: number,
  fixtureIndex = requestIndex % CHECKOUT_RESERVATION_PROVIDER_FIXTURE_COUNT,
) {
  const fixture = checkoutReservationProviderFixture(runSlot, fixtureIndex);
  const listing = await readFixtureListing(fixture.listingId);
  if (!listing) throw new Error("provider candidate fixture is unavailable");
  const sourceSignature = pricedSignature(fixture.buyerId, listing);
  const selectedVariantOptionIds = [listing.variantGroups[0]!.options[0]!.id];
  const sourcePayloadHash = payloadHash(runSlot, label, requestIndex);
  const creation = await prisma.$transaction(async (tx) => {
    const created = await createSingleCheckoutStockReservation({
      buyerId: fixture.buyerId,
      listingId: fixture.listingId,
      payloadHash: sourcePayloadHash,
      quantity: 1,
    }, tx);
    await lockCheckoutReservationSellerSource(tx, fixture.sellerProfileId);
    const lockedListing = await readFixtureListing(fixture.listingId, tx);
    const lockedSignature = lockedListing
      ? singleCheckoutReservationSourceSignature(
          fixture.buyerId,
          lockedListing,
          1,
          selectedVariantOptionIds,
        )
      : null;
    const lockedInventory = lockedListing?.listingType === "IN_STOCK"
      ? [{ listingId: lockedListing.id, sellerId: lockedListing.sellerId, quantity: 1 }]
      : [];
    if (
      !created ||
      lockedSignature !== sourceSignature ||
      !checkoutReservationInventorySourceMatches(created.reservedItems, lockedInventory)
    ) {
      throw new CheckoutReservationSourceChangedError();
    }
    return created;
  });
  await restoreFixtureReservation(creation, fixture.buyerId, sourcePayloadHash);
}

function evaluateCandidate(
  issues: string[],
  baseline: WorkloadResult,
  candidate: WorkloadResult,
) {
  if (baseline.errorCount > 0 || candidate.errorCount > 0) {
    issues.push(`${candidate.label} or its baseline had request errors`);
  }
  if (candidate.p95Ms > 750) {
    issues.push(`${candidate.label} p95 exceeded the fixed 750ms checkout ceiling`);
  }
  if (candidate.maxMs > 3_000) {
    issues.push(`${candidate.label} max exceeded the fixed 3000ms checkout ceiling`);
  }
  if (candidate.meanMs > Math.max(baseline.meanMs * 4, baseline.meanMs + 100)) {
    issues.push(`${candidate.label} mean exceeded the bounded baseline allowance`);
  }
  if (candidate.p95Ms > Math.max(baseline.p95Ms * 4, baseline.p95Ms + 150)) {
    issues.push(`${candidate.label} p95 exceeded the bounded baseline allowance`);
  }
}

async function measurePair(
  config: CheckoutReservationProviderGateConfig,
  label: string,
  concurrency: number,
) {
  const primeRequests = Math.max(config.warmupRequests, concurrency);
  const baselinePrime = () => measureWorkload(
    `${label}_baseline_prime`,
    primeRequests,
    concurrency,
    (index) => runBaseline(config.runSlot, `${label}-baseline-prime`, index),
  );
  const candidatePrime = () => measureWorkload(
    `${label}_candidate_prime`,
    primeRequests,
    concurrency,
    (index) => runCandidate(config.runSlot, `${label}-candidate-prime`, index),
  );
  const baselineWork = () => measureWorkload(
    `${label}_baseline`,
    config.measuredRequests,
    concurrency,
    (index) => runBaseline(config.runSlot, `${label}-baseline`, index),
  );
  const candidateWork = () => measureWorkload(
    `${label}_candidate`,
    config.measuredRequests,
    concurrency,
    (index) => runCandidate(config.runSlot, `${label}-candidate`, index),
  );

  let baseline: WorkloadResult;
  let candidate: WorkloadResult;
  if (config.runSlot === 1) {
    if ((await baselinePrime()).errorCount > 0) throw new Error("provider baseline prime failed");
    baseline = await baselineWork();
    if ((await candidatePrime()).errorCount > 0) throw new Error("provider candidate prime failed");
    candidate = await candidateWork();
  } else {
    if ((await candidatePrime()).errorCount > 0) throw new Error("provider candidate prime failed");
    candidate = await candidateWork();
    if ((await baselinePrime()).errorCount > 0) throw new Error("provider baseline prime failed");
    baseline = await baselineWork();
  }
  return Object.freeze({ baseline, candidate });
}

async function proveBoundedSameListingWait(runSlot: 1 | 2) {
  const fixture = checkoutReservationProviderFixture(runSlot, 0);
  let releaseBlocker!: () => void;
  let reportBlockerReady!: () => void;
  const blockerRelease = new Promise<void>((resolve) => { releaseBlocker = resolve; });
  const blockerReady = new Promise<void>((resolve) => { reportBlockerReady = resolve; });
  const blocker = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT listing.id
        FROM public."Listing" AS listing
       WHERE listing.id = ${fixture.listingId}
       FOR UPDATE
    `;
    reportBlockerReady();
    await blockerRelease;
  });
  await blockerReady;

  let settled = false;
  const startedAt = performance.now();
  const waitingCandidate = runCandidate(runSlot, "bounded-wait", 10_000, 0)
    .finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 125));
  const waitedForLock = !settled;
  releaseBlocker();
  await blocker;
  await waitingCandidate;
  const durationMs = rounded(performance.now() - startedAt);
  return Object.freeze({
    durationMs,
    passed: waitedForLock && durationMs >= 100 && durationMs <= 2_000,
    waitedForLock,
  });
}

async function fixtureCatalog(runSlot: 1 | 2) {
  const fixture = checkoutReservationProviderFixture(runSlot, 0);
  const sellerId = fixture.sellerProfileId;
  const reservationRows = await exportCheckoutStockReservations(fixture.sellerUserId);
  const rows = await prisma.$queryRaw<Array<{
    currentUser: string;
    fixtureListings: bigint | number;
    minimumStock: bigint | number;
  }>>`
    SELECT
      CURRENT_USER::text AS "currentUser",
      (
        SELECT pg_catalog.count(*)
          FROM public."Listing" AS listing
         WHERE listing."sellerId" = ${sellerId}
      ) AS "fixtureListings",
      (
        SELECT COALESCE(pg_catalog.min(listing."stockQuantity"), -1)
          FROM public."Listing" AS listing
         WHERE listing."sellerId" = ${sellerId}
      ) AS "minimumStock"
  `;
  if (rows.length !== 1) throw new Error("provider fixture catalog returned an invalid row count");
  return Object.freeze({
    activeReservations: reservationRows.filter((reservation) => reservation.status === "RESERVED").length,
    currentUser: rows[0]!.currentUser,
    fixtureListings: Number(rows[0]!.fixtureListings),
    minimumStock: Number(rows[0]!.minimumStock),
  });
}

export async function runCheckoutStockReservationProviderGate(
  config: CheckoutReservationProviderGateConfig,
) {
  const issues: string[] = [];
  const before = await fixtureCatalog(config.runSlot);
  if (
    before.currentUser !== "grainline_app_runtime" ||
    before.fixtureListings !== CHECKOUT_RESERVATION_PROVIDER_FIXTURE_COUNT ||
    before.minimumStock < 10_000 ||
    before.activeReservations !== 0
  ) {
    throw new Error("provider fixture catalog did not match the reviewed runtime state");
  }

  const target = await measurePair(config, "same_seller_different_listing_target", config.targetConcurrency);
  const burst = await measurePair(config, "same_seller_different_listing_burst", config.burstConcurrency);
  evaluateCandidate(issues, target.baseline, target.candidate);
  evaluateCandidate(issues, burst.baseline, burst.candidate);
  const sameListingWait = await proveBoundedSameListingWait(config.runSlot);
  if (!sameListingWait.passed) issues.push("same-listing lock wait did not meet the bounded wait contract");

  const after = await fixtureCatalog(config.runSlot);
  if (
    after.activeReservations !== 0 ||
    after.minimumStock !== before.minimumStock ||
    after.fixtureListings !== before.fixtureListings ||
    after.currentUser !== before.currentUser
  ) {
    issues.push("provider fixture state did not return to its reviewed baseline");
  }

  return Object.freeze({
    catalog: after,
    issueCount: issues.length,
    issues,
    sameListingWait,
    workloads: Object.freeze({ burst, target }),
  });
}

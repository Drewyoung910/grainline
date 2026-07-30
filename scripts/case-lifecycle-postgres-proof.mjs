#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import {
  databaseClockTimestamp,
  lockOrderForCaseLifecycle,
} from "../src/lib/caseLifecycleLocks.ts";
import {
  canCreateCaseMessageForStatus,
  caseMessageStatusTransition,
} from "../src/lib/caseMessagingState.ts";
import { REFUND_LOCK_SENTINEL } from "../src/lib/refundLockState.ts";

const DATABASE_NAME = "grainline_ci";
const PROOF_ENV = "CASE_LIFECYCLE_PROOF_DATABASE_URL";
const TRANSACTION_OPTIONS = Object.freeze({ maxWait: 5_000, timeout: 15_000 });
const ids = Object.freeze({
  buyer: "case-lifecycle-proof-buyer",
  seller: "case-lifecycle-proof-seller",
  staff: "case-lifecycle-proof-staff",
  sellerProfile: "case-lifecycle-proof-seller-profile",
  listing: "case-lifecycle-proof-listing",
  order: "case-lifecycle-proof-order",
  orderItem: "case-lifecycle-proof-order-item",
});

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function applicationUrl(databaseUrl, applicationName) {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set("application_name", applicationName);
  return parsed.toString();
}

function createClient(databaseUrl, applicationName) {
  const adapter = new PrismaPg({
    connectionString: applicationUrl(databaseUrl, applicationName),
  });
  return new PrismaClient({ adapter });
}

export function parseProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case lifecycle proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case lifecycle proof requires the ${DATABASE_NAME} database`,
  );
  return { databaseUrl };
}

async function cleanupFixtures(client) {
  await client.case.deleteMany({
    where: { id: { startsWith: "case-lifecycle-proof-case-" } },
  });
  await client.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminId: { in: [ids.buyer, ids.seller, ids.staff] } },
        { targetId: { startsWith: "case-lifecycle-proof-case-" } },
      ],
    },
  });
  await client.orderPaymentEvent.deleteMany({ where: { orderId: ids.order } });
  await client.orderItem.deleteMany({ where: { id: ids.orderItem } });
  await client.order.deleteMany({ where: { id: ids.order } });
  await client.listing.deleteMany({ where: { id: ids.listing } });
  await client.sellerProfile.deleteMany({ where: { id: ids.sellerProfile } });
  await client.user.deleteMany({
    where: { id: { in: [ids.buyer, ids.seller, ids.staff] } },
  });
}

async function lockCaseForLifecycle(tx, caseId) {
  const rows = await tx.$queryRaw`
    SELECT id
    FROM "Case"
    WHERE id = ${caseId}
    FOR UPDATE
  `;
  assert.ok(rows.length <= 1, "Case lock returned invalid cardinality");
  assert.equal(rows[0]?.id ?? caseId, caseId, "Case lock returned the wrong row");
  return rows.length === 1;
}

async function seedFixtures(client) {
  await cleanupFixtures(client);
  await client.user.createMany({
    data: [
      {
        id: ids.buyer,
        clerkId: "clerk-case-lifecycle-proof-buyer",
        email: "case-lifecycle-proof-buyer@example.invalid",
        name: "Case Lifecycle Proof Buyer",
      },
      {
        id: ids.seller,
        clerkId: "clerk-case-lifecycle-proof-seller",
        email: "case-lifecycle-proof-seller@example.invalid",
        name: "Case Lifecycle Proof Seller",
      },
      {
        id: ids.staff,
        clerkId: "clerk-case-lifecycle-proof-staff",
        email: "case-lifecycle-proof-staff@example.invalid",
        name: "Case Lifecycle Proof Staff",
        role: "ADMIN",
      },
    ],
  });
  await client.sellerProfile.create({
    data: {
      id: ids.sellerProfile,
      userId: ids.seller,
      displayName: "Case Lifecycle Proof Seller",
      displayNameNormalized: "case lifecycle proof seller",
    },
  });
  await client.listing.create({
    data: {
      id: ids.listing,
      sellerId: ids.sellerProfile,
      title: "Case lifecycle proof listing",
      description: "Disposable loopback-only concurrency fixture.",
      priceCents: 10_000,
      listingType: "IN_STOCK",
      stockQuantity: 1,
    },
  });
  await client.order.create({
    data: {
      id: ids.order,
      buyerId: ids.buyer,
      fulfillmentMethod: "SHIPPING",
      fulfillmentStatus: "PENDING",
      estimatedDeliveryDate: new Date(Date.now() - 60_000),
      reviewNeeded: true,
      reviewNote: "Disposable Case lifecycle proof fixture",
      items: {
        create: {
          id: ids.orderItem,
          listingId: ids.listing,
          quantity: 1,
          priceCents: 10_000,
        },
      },
    },
  });
}

async function resetOrder(client, fulfillmentStatus = "PENDING") {
  await client.case.deleteMany({
    where: { id: { startsWith: "case-lifecycle-proof-case-" } },
  });
  await client.order.update({
    where: { id: ids.order },
    data: {
      fulfillmentMethod: "SHIPPING",
      fulfillmentStatus,
      shippedAt: fulfillmentStatus === "SHIPPED" ? new Date(Date.now() - 60_000) : null,
      deliveredAt: null,
      labelStatus: null,
      sellerRefundId: null,
      sellerRefundLockedAt: null,
      estimatedDeliveryDate: new Date(Date.now() - 60_000),
      reviewNeeded: true,
      reviewNote: "Disposable Case lifecycle proof fixture",
    },
  });
}

async function resetCase(
  client,
  suffix,
  {
    status,
    buyerMarkedResolved = false,
    sellerMarkedResolved = false,
    sellerRespondBy = new Date(Date.now() + 48 * 60 * 60 * 1_000),
    discussionStartedAt = null,
    escalateUnlocksAt = null,
  },
) {
  await resetOrder(client, "SHIPPED");
  const fixtureCreatedAt = new Date(
    Math.min(
      Date.now() - 5 * 60_000,
      sellerRespondBy.getTime() - 60_000,
      discussionStartedAt
        ? discussionStartedAt.getTime() - 60_000
        : Number.POSITIVE_INFINITY,
    ),
  );
  return client.$transaction(async (tx) => {
    const created = await tx.case.create({
      data: {
        id: `case-lifecycle-proof-case-${suffix}`,
        orderId: ids.order,
        buyerId: ids.buyer,
        sellerId: ids.seller,
        reason: "OTHER",
        description: "Disposable Case lifecycle concurrency fixture.",
        status,
        buyerMarkedResolved,
        sellerMarkedResolved,
        createdAt: fixtureCreatedAt,
        sellerRespondBy,
        discussionStartedAt,
        escalateUnlocksAt,
      },
    });
    await tx.caseMessage.create({
      data: {
        id: `case-lifecycle-proof-message-${suffix}-opening`,
        caseId: created.id,
        authorId: ids.buyer,
        authorKind: "BUYER",
        body: "Disposable Case lifecycle opening message.",
      },
    });
    return created;
  });
}

async function waitForLock(observer, applicationName) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await observer.$queryRaw`
      SELECT wait_event_type, wait_event
      FROM pg_catalog.pg_stat_activity
      WHERE application_name = ${applicationName}
        AND pid <> pg_catalog.pg_backend_pid()
        AND state <> 'idle'
      ORDER BY backend_start DESC
      LIMIT 1
    `;
    if (rows[0]?.wait_event_type === "Lock") {
      return {
        waitEvent: rows[0].wait_event,
        waitEventType: rows[0].wait_event_type,
      };
    }
    await sleep(25);
  }
  throw new Error(`${applicationName} did not enter a PostgreSQL lock wait`);
}

async function runContendedOrdering({
  observer,
  firstClient,
  secondClient,
  secondApplicationName,
  firstWork,
  secondWork,
}) {
  const ready = deferred();
  const release = deferred();
  const firstPromise = firstClient
    .$transaction(async (tx) => {
      const result = await firstWork(tx);
      ready.resolve();
      await release.promise;
      return result;
    }, TRANSACTION_OPTIONS)
    .catch((error) => {
      ready.reject(error);
      throw error;
    });

  await ready.promise;
  const secondPromise = secondClient.$transaction(secondWork, TRANSACTION_OPTIONS);
  let lockEvidence;
  try {
    lockEvidence = await Promise.race([
      waitForLock(observer, secondApplicationName),
      secondPromise.then(
        () => {
          throw new Error(
            `${secondApplicationName} completed without the required lock wait`,
          );
        },
        (error) => Promise.reject(error),
      ),
    ]);
  } finally {
    release.resolve();
  }
  const [firstResult, secondResult] = await Promise.all([
    firstPromise,
    secondPromise,
  ]);
  return { firstResult, lockEvidence, secondResult };
}

async function attemptCaseCreate(tx, suffix) {
  const orderExists = await lockOrderForCaseLifecycle(tx, ids.order);
  if (!orderExists) return { outcome: "rejected_missing_order" };
  const order = await tx.order.findUnique({
    where: { id: ids.order },
    include: {
      case: { select: { id: true } },
      items: {
        include: {
          listing: {
            select: {
              seller: { select: { userId: true } },
            },
          },
        },
      },
    },
  });
  assert.ok(order, "locked proof Order disappeared");
  if (order.case) return { outcome: "rejected_existing_case" };
  if (order.sellerRefundId) return { outcome: "rejected_refund" };
  if (
    order.labelStatus === "PURCHASED" &&
    order.fulfillmentStatus === "PENDING"
  ) {
    return { outcome: "rejected_label" };
  }
  const sellerIds = new Set(
    order.items.map((item) => item.listing.seller.userId),
  );
  assert.deepEqual([...sellerIds], [ids.seller]);
  assert.equal(order.buyerId, ids.buyer);
  const now = await databaseClockTimestamp(tx);
  const created = await tx.case.create({
    data: {
      id: `case-lifecycle-proof-case-${suffix}`,
      orderId: ids.order,
      buyerId: ids.buyer,
      sellerId: ids.seller,
      reason: "OTHER",
      description: "Disposable Case lifecycle concurrency fixture.",
      sellerRespondBy: new Date(now.getTime() + 48 * 60 * 60 * 1_000),
    },
    select: { id: true },
  });
  await tx.caseMessage.create({
    data: {
      id: `case-lifecycle-proof-message-${suffix}`,
      caseId: created.id,
      authorId: ids.buyer,
      authorKind: "BUYER",
      body: "Disposable Case lifecycle opening message.",
    },
  });
  return { caseId: created.id, outcome: "created" };
}

async function attemptLabelReservation(tx) {
  assert.equal(await lockOrderForCaseLifecycle(tx, ids.order), true);
  const count = await tx.$executeRaw`
    UPDATE "Order"
    SET "labelStatus" = 'PURCHASED'::"LabelStatus"
    WHERE id = ${ids.order}
      AND "fulfillmentStatus" = 'PENDING'::"FulfillmentStatus"
      AND "sellerRefundId" IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "Case"
        WHERE "orderId" = ${ids.order}
          AND status::text IN ('OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW')
      )
  `;
  return Number(count);
}

async function attemptFulfillment(tx) {
  assert.equal(await lockOrderForCaseLifecycle(tx, ids.order), true);
  const transitionAt = await databaseClockTimestamp(tx);
  const count = await tx.$executeRaw`
    UPDATE "Order"
    SET "fulfillmentStatus" = 'SHIPPED'::"FulfillmentStatus",
        "shippedAt" = ${transitionAt}
    WHERE id = ${ids.order}
      AND "fulfillmentStatus" = 'PENDING'::"FulfillmentStatus"
      AND "sellerRefundId" IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "Case"
        WHERE "orderId" = ${ids.order}
          AND status::text IN ('OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW')
      )
  `;
  return Number(count);
}

async function attemptDeliveryConfirmation(tx) {
  assert.equal(await lockOrderForCaseLifecycle(tx, ids.order), true);
  const transitionAt = await databaseClockTimestamp(tx);
  const count = await tx.$executeRaw`
    UPDATE "Order"
    SET "fulfillmentStatus" = 'DELIVERED'::"FulfillmentStatus",
        "deliveredAt" = ${transitionAt}
    WHERE id = ${ids.order}
      AND "buyerId" = ${ids.buyer}
      AND "fulfillmentStatus" = 'SHIPPED'::"FulfillmentStatus"
      AND "sellerRefundId" IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "Case"
        WHERE "orderId" = ${ids.order}
          AND status::text IN ('OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW')
      )
  `;
  return Number(count);
}

async function attemptRefundReservation(tx) {
  assert.equal(await lockOrderForCaseLifecycle(tx, ids.order), true);
  const lockedAt = await databaseClockTimestamp(tx);
  const count = await tx.$executeRaw`
    UPDATE "Order"
    SET "sellerRefundId" = ${REFUND_LOCK_SENTINEL},
        "sellerRefundLockedAt" = ${lockedAt}
    WHERE id = ${ids.order}
      AND "sellerRefundId" IS NULL
      AND ("labelStatus" IS NULL OR "labelStatus" != 'PURCHASED'::"LabelStatus")
  `;
  return Number(count);
}

async function attemptReply(tx, { actorId, body, suffix }) {
  const caseId = `case-lifecycle-proof-case-${suffix.split("-")[0]}`;
  if (!(await lockCaseForLifecycle(tx, caseId))) {
    return { outcome: "rejected_missing_case" };
  }
  const caseRecord = await tx.case.findUnique({ where: { id: caseId } });
  assert.ok(caseRecord, "locked proof Case disappeared");
  const isParty =
    actorId === caseRecord.buyerId || actorId === caseRecord.sellerId;
  if (
    !isParty ||
    !canCreateCaseMessageForStatus(caseRecord.status, { isStaff: false })
  ) {
    return { outcome: "rejected_status" };
  }
  const transitionAt = await databaseClockTimestamp(tx);
  const transition = caseMessageStatusTransition({
    status: caseRecord.status,
    actorId,
    buyerId: caseRecord.buyerId,
    sellerId: caseRecord.sellerId,
    isStaff: false,
  });
  const data =
    transition === "seller_started_discussion"
      ? {
          status: "IN_DISCUSSION",
          discussionStartedAt: transitionAt,
          escalateUnlocksAt: new Date(
            transitionAt.getTime() + 48 * 60 * 60 * 1_000,
          ),
          updatedAt: transitionAt,
        }
      : transition === "party_reopened_pending_close"
        ? {
            status: "IN_DISCUSSION",
            buyerMarkedResolved: false,
            sellerMarkedResolved: false,
            updatedAt: transitionAt,
          }
        : { updatedAt: transitionAt };
  await tx.case.update({ where: { id: caseId }, data });
  await tx.caseMessage.create({
    data: {
      id: `case-lifecycle-proof-message-${suffix}`,
      caseId,
      authorId: actorId,
      authorKind: actorId === ids.buyer ? "BUYER" : "SELLER",
      body,
      createdAt: transitionAt,
    },
  });
  return {
    at: transitionAt,
    outcome: "created",
    transition,
  };
}

async function attemptBuyerMarkResolved(tx, caseId) {
  assert.equal(await lockOrderForCaseLifecycle(tx, ids.order), true);
  const order = await tx.order.findUnique({
    where: { id: ids.order },
    select: { sellerRefundId: true },
  });
  assert.ok(order, "locked proof Order disappeared");
  if (order.sellerRefundId) {
    return { at: null, count: 0, outcome: "rejected_refund" };
  }
  assert.equal(await lockCaseForLifecycle(tx, caseId), true);
  const caseRecord = await tx.case.findUnique({ where: { id: caseId } });
  assert.ok(caseRecord, "locked proof Case disappeared");
  if (
    caseRecord.status !== "OPEN"
    && caseRecord.status !== "IN_DISCUSSION"
    && caseRecord.status !== "PENDING_CLOSE"
  ) {
    return { at: null, count: 0, outcome: "rejected_status" };
  }
  const transitionAt = await databaseClockTimestamp(tx);
  const rows = await tx.$queryRaw`
    UPDATE "Case"
    SET "buyerMarkedResolved" = true,
        status = CASE
          WHEN "sellerMarkedResolved"
            THEN 'RESOLVED'::"CaseStatus"
          ELSE 'PENDING_CLOSE'::"CaseStatus"
        END,
        resolution = CASE
          WHEN "sellerMarkedResolved"
            THEN 'DISMISSED'::"CaseResolution"
          ELSE NULL
        END,
        "resolvedAt" = CASE
          WHEN "sellerMarkedResolved"
            THEN CAST(${transitionAt} AS timestamp without time zone)
          ELSE NULL
        END,
        "resolvedById" = CASE
          WHEN "sellerMarkedResolved" THEN ${ids.buyer}
          ELSE NULL
        END,
        "updatedAt" = ${transitionAt}
    WHERE id = ${caseId}
      AND status::text IN ('OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE')
    RETURNING id, status::text
  `;
  return {
    at: rows.length === 1 ? transitionAt : null,
    count: rows.length,
    outcome: rows.length === 1 ? "updated" : "rejected_status",
    status: rows[0]?.status ?? null,
  };
}

async function attemptCronEscalation(tx, caseId) {
  const rows = await tx.$queryRaw`
    UPDATE "Case"
    SET status = 'UNDER_REVIEW'::"CaseStatus",
        "updatedAt" = pg_catalog.clock_timestamp()
    WHERE id = ${caseId}
      AND (
        (status = 'OPEN'::"CaseStatus" AND "sellerRespondBy" < pg_catalog.clock_timestamp())
        OR (
          status = 'IN_DISCUSSION'::"CaseStatus"
          AND "escalateUnlocksAt" < pg_catalog.clock_timestamp()
        )
      )
    RETURNING id, "updatedAt"
  `;
  return {
    at: rows[0]?.updatedAt ?? null,
    count: rows.length,
  };
}

async function attemptStaffDismissal(tx, caseId) {
  assert.equal(await lockOrderForCaseLifecycle(tx, ids.order), true);
  assert.equal(await lockCaseForLifecycle(tx, caseId), true);
  const caseRecord = await tx.case.findUnique({ where: { id: caseId } });
  const staff = await tx.user.findUnique({ where: { id: ids.staff } });
  assert.ok(caseRecord, "locked proof Case disappeared");
  assert.equal(staff?.role, "ADMIN");
  if (
    caseRecord.resolvedAt
    || caseRecord.status === "RESOLVED"
    || caseRecord.status === "CLOSED"
  ) {
    return { at: null, outcome: "rejected_status" };
  }
  const transitionAt = await databaseClockTimestamp(tx);
  await tx.order.update({
    where: { id: ids.order },
    data: {
      reviewNeeded: true,
      reviewNote: "Disposable Case lifecycle staff dismissal.",
    },
  });
  await tx.case.update({
    where: { id: caseId },
    data: {
      status: "RESOLVED",
      resolution: "DISMISSED",
      resolvedAt: transitionAt,
      resolvedById: ids.staff,
      updatedAt: transitionAt,
    },
  });
  await tx.caseMessage.create({
    data: {
      id: `case-lifecycle-proof-message-${caseId.split("-").at(-1)}-dismissed`,
      caseId,
      authorId: ids.staff,
      authorKind: "STAFF",
      body: "Grainline reviewed this case and dismissed it.",
      createdAt: transitionAt,
    },
  });
  await tx.adminAuditLog.create({
    data: {
      adminId: ids.staff,
      action: "RESOLVE_CASE",
      targetType: "CASE",
      targetId: caseId,
      reason: "DISMISSED",
      metadata: {
        orderId: ids.order,
        resolution: "DISMISSED",
        at: transitionAt.toISOString(),
      },
    },
  });
  return { at: transitionAt, outcome: "resolved" };
}

function recordCheck(checks, name, result) {
  checks.push({
    name,
    lockWaitObserved: result.lockEvidence.waitEventType === "Lock",
    waitEvent: result.lockEvidence.waitEvent,
  });
}

async function runProof({ databaseUrl }) {
  const observer = createClient(databaseUrl, "case-lifecycle-proof-observer");
  const first = createClient(databaseUrl, "case-lifecycle-proof-first");
  const second = createClient(databaseUrl, "case-lifecycle-proof-second");
  const checks = [];

  try {
    await seedFixtures(observer);

    await resetOrder(observer);
    let result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) => attemptCaseCreate(tx, "case-first-label"),
      secondWork: attemptLabelReservation,
    });
    assert.equal(result.firstResult.outcome, "created");
    assert.equal(result.secondResult, 0);
    recordCheck(checks, "case_before_label", result);

    await resetOrder(observer);
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: attemptLabelReservation,
      secondWork: (tx) => attemptCaseCreate(tx, "label-first-case"),
    });
    assert.equal(result.firstResult, 1);
    assert.equal(result.secondResult.outcome, "rejected_label");
    recordCheck(checks, "label_before_case", result);

    await resetOrder(observer);
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) => attemptCaseCreate(tx, "case-first-fulfillment"),
      secondWork: attemptFulfillment,
    });
    assert.equal(result.firstResult.outcome, "created");
    assert.equal(result.secondResult, 0);
    recordCheck(checks, "case_before_fulfillment", result);

    await resetOrder(observer);
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: attemptFulfillment,
      secondWork: (tx) => attemptCaseCreate(tx, "fulfillment-first-case"),
    });
    assert.equal(result.firstResult, 1);
    assert.equal(result.secondResult.outcome, "created");
    recordCheck(checks, "fulfillment_before_case", result);

    await resetOrder(observer, "SHIPPED");
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) => attemptCaseCreate(tx, "case-first-delivery"),
      secondWork: attemptDeliveryConfirmation,
    });
    assert.equal(result.firstResult.outcome, "created");
    assert.equal(result.secondResult, 0);
    recordCheck(checks, "case_before_delivery_confirmation", result);

    await resetOrder(observer, "SHIPPED");
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: attemptDeliveryConfirmation,
      secondWork: (tx) => attemptCaseCreate(tx, "delivery-first-case"),
    });
    assert.equal(result.firstResult, 1);
    assert.equal(result.secondResult.outcome, "created");
    recordCheck(checks, "delivery_confirmation_before_case", result);

    await resetOrder(observer);
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: attemptRefundReservation,
      secondWork: (tx) => attemptCaseCreate(tx, "refund-first-case"),
    });
    assert.equal(result.firstResult, 1);
    assert.equal(result.secondResult.outcome, "rejected_refund");
    recordCheck(checks, "refund_before_case", result);

    await resetOrder(observer);
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) => attemptCaseCreate(tx, "case-first-refund"),
      secondWork: attemptRefundReservation,
    });
    assert.equal(result.firstResult.outcome, "created");
    assert.equal(result.secondResult, 1);
    await observer.case.update({
      where: { id: result.firstResult.caseId },
      data: {
        status: "RESOLVED",
        resolution: "REFUND_FULL",
        refundAmountCents: 10_000,
        stripeRefundId: "case-lifecycle-proof-refund",
        resolvedAt: new Date(),
        resolvedById: ids.seller,
      },
    });
    recordCheck(checks, "case_before_refund_then_resolution", result);

    let caseRecord = await resetCase(observer, "different", {
      status: "IN_DISCUSSION",
      discussionStartedAt: new Date(Date.now() - 60_000),
      escalateUnlocksAt: new Date(Date.now() + 60_000),
    });
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) =>
        attemptReply(tx, {
          actorId: ids.buyer,
          body: "First different-body proof reply.",
          suffix: "different-first",
        }),
      secondWork: (tx) =>
        attemptReply(tx, {
          actorId: ids.seller,
          body: "Second different-body proof reply.",
          suffix: "different-second",
        }),
    });
    assert.equal(result.firstResult.outcome, "created");
    assert.equal(result.secondResult.outcome, "created");
    assert.ok(result.secondResult.at.getTime() >= result.firstResult.at.getTime());
    caseRecord = await observer.case.findUniqueOrThrow({
      where: { id: caseRecord.id },
    });
    assert.equal(
      caseRecord.updatedAt.getTime(),
      result.secondResult.at.getTime(),
    );
    recordCheck(checks, "different_body_replies_serialize", result);

    caseRecord = await resetCase(observer, "sellerfirst", { status: "OPEN" });
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) =>
        attemptReply(tx, {
          actorId: ids.seller,
          body: "First seller response.",
          suffix: "sellerfirst-first",
        }),
      secondWork: (tx) =>
        attemptReply(tx, {
          actorId: ids.seller,
          body: "Concurrent seller response.",
          suffix: "sellerfirst-second",
        }),
    });
    assert.equal(result.firstResult.transition, "seller_started_discussion");
    assert.equal(result.secondResult.transition, "none");
    caseRecord = await observer.case.findUniqueOrThrow({
      where: { id: caseRecord.id },
    });
    assert.equal(caseRecord.status, "IN_DISCUSSION");
    assert.ok(caseRecord.discussionStartedAt);
    assert.ok(caseRecord.escalateUnlocksAt);
    recordCheck(checks, "seller_first_reply_sets_one_discussion_clock", result);

    caseRecord = await resetCase(observer, "pendingreplyfirst", {
      status: "PENDING_CLOSE",
      buyerMarkedResolved: true,
      sellerMarkedResolved: false,
    });
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) =>
        attemptReply(tx, {
          actorId: ids.seller,
          body: "Reply wins before mark.",
          suffix: "pendingreplyfirst-first",
        }),
      secondWork: (tx) => attemptBuyerMarkResolved(tx, caseRecord.id),
    });
    assert.equal(result.firstResult.transition, "party_reopened_pending_close");
    assert.equal(result.secondResult.count, 1);
    assert.ok(
      result.secondResult.at.getTime() >= result.firstResult.at.getTime(),
    );
    caseRecord = await observer.case.findUniqueOrThrow({
      where: { id: caseRecord.id },
    });
    assert.equal(caseRecord.status, "PENDING_CLOSE");
    assert.equal(caseRecord.buyerMarkedResolved, true);
    recordCheck(checks, "pending_close_reply_before_resolution_mark", result);

    caseRecord = await resetCase(observer, "pendingmarkfirst", {
      status: "PENDING_CLOSE",
      buyerMarkedResolved: false,
      sellerMarkedResolved: true,
    });
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) => attemptBuyerMarkResolved(tx, caseRecord.id),
      secondWork: (tx) =>
        attemptReply(tx, {
          actorId: ids.seller,
          body: "Reply follows the resolution mark.",
          suffix: "pendingmarkfirst-second",
        }),
    });
    assert.equal(result.firstResult.count, 1);
    assert.equal(result.firstResult.status, "RESOLVED");
    assert.equal(result.secondResult.outcome, "rejected_status");
    caseRecord = await observer.case.findUniqueOrThrow({
      where: { id: caseRecord.id },
    });
    assert.equal(caseRecord.status, "RESOLVED");
    assert.equal(caseRecord.resolution, "DISMISSED");
    assert.equal(caseRecord.buyerMarkedResolved, true);
    assert.equal(caseRecord.sellerMarkedResolved, true);
    recordCheck(checks, "resolution_mark_before_pending_close_reply", result);

    caseRecord = await resetCase(observer, "refundmarkfirst", {
      status: "IN_DISCUSSION",
      discussionStartedAt: new Date(Date.now() - 60_000),
      escalateUnlocksAt: new Date(Date.now() + 60_000),
    });
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: attemptRefundReservation,
      secondWork: (tx) => attemptBuyerMarkResolved(tx, caseRecord.id),
    });
    assert.equal(result.firstResult, 1);
    assert.equal(result.secondResult.outcome, "rejected_refund");
    recordCheck(checks, "refund_reservation_before_resolution_mark", result);

    caseRecord = await resetCase(observer, "markrefundfirst", {
      status: "IN_DISCUSSION",
      discussionStartedAt: new Date(Date.now() - 60_000),
      escalateUnlocksAt: new Date(Date.now() + 60_000),
    });
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) => attemptBuyerMarkResolved(tx, caseRecord.id),
      secondWork: attemptRefundReservation,
    });
    assert.equal(result.firstResult.outcome, "updated");
    assert.equal(result.secondResult, 1);
    recordCheck(checks, "resolution_mark_before_refund_reservation", result);

    caseRecord = await resetCase(observer, "replycronfirst", {
      status: "OPEN",
      sellerRespondBy: new Date(Date.now() - 60_000),
    });
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) =>
        attemptReply(tx, {
          actorId: ids.seller,
          body: "Seller response wins before cron.",
          suffix: "replycronfirst-first",
        }),
      secondWork: (tx) => attemptCronEscalation(tx, caseRecord.id),
    });
    assert.equal(result.firstResult.transition, "seller_started_discussion");
    assert.equal(result.secondResult.count, 0);
    recordCheck(checks, "seller_reply_before_cron", result);

    caseRecord = await resetCase(observer, "cronreplyfirst", {
      status: "OPEN",
      sellerRespondBy: new Date(Date.now() - 60_000),
    });
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) => attemptCronEscalation(tx, caseRecord.id),
      secondWork: (tx) =>
        attemptReply(tx, {
          actorId: ids.seller,
          body: "Seller response loses to cron.",
          suffix: "cronreplyfirst-second",
        }),
    });
    assert.equal(result.firstResult.count, 1);
    assert.equal(result.secondResult.outcome, "rejected_status");
    recordCheck(checks, "cron_before_seller_reply", result);

    caseRecord = await resetCase(observer, "discussioncron", {
      status: "IN_DISCUSSION",
      discussionStartedAt: new Date(Date.now() - 120_000),
      escalateUnlocksAt: new Date(Date.now() - 60_000),
    });
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) =>
        attemptReply(tx, {
          actorId: ids.buyer,
          body: "Discussion reply commits before eligible cron escalation.",
          suffix: "discussioncron-first",
        }),
      secondWork: (tx) => attemptCronEscalation(tx, caseRecord.id),
    });
    assert.equal(result.firstResult.outcome, "created");
    assert.equal(result.secondResult.count, 1);
    assert.ok(
      result.secondResult.at.getTime() >= result.firstResult.at.getTime(),
    );
    recordCheck(
      checks,
      "discussion_reply_before_cron_keeps_time_monotonic",
      result,
    );

    caseRecord = await resetCase(observer, "replydismissfirst", {
      status: "IN_DISCUSSION",
      discussionStartedAt: new Date(Date.now() - 60_000),
      escalateUnlocksAt: new Date(Date.now() + 60_000),
    });
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) =>
        attemptReply(tx, {
          actorId: ids.buyer,
          body: "Reply commits before staff dismissal.",
          suffix: "replydismissfirst-first",
        }),
      secondWork: (tx) => attemptStaffDismissal(tx, caseRecord.id),
    });
    assert.equal(result.firstResult.outcome, "created");
    assert.equal(result.secondResult.outcome, "resolved");
    assert.ok(
      result.secondResult.at.getTime() >= result.firstResult.at.getTime(),
    );
    const dismissedMessages = await observer.caseMessage.findMany({
      where: { caseId: caseRecord.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { authorKind: true, createdAt: true },
    });
    assert.equal(dismissedMessages.at(-1)?.authorKind, "STAFF");
    assert.equal(
      dismissedMessages.at(-1)?.createdAt.getTime(),
      result.secondResult.at.getTime(),
    );
    recordCheck(checks, "reply_before_staff_dismissal", result);

    caseRecord = await resetCase(observer, "markdismissfirst", {
      status: "IN_DISCUSSION",
      discussionStartedAt: new Date(Date.now() - 60_000),
      escalateUnlocksAt: new Date(Date.now() + 60_000),
    });
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) => attemptBuyerMarkResolved(tx, caseRecord.id),
      secondWork: (tx) => attemptStaffDismissal(tx, caseRecord.id),
    });
    assert.equal(result.firstResult.outcome, "updated");
    assert.equal(result.secondResult.outcome, "resolved");
    assert.ok(
      result.secondResult.at.getTime() >= result.firstResult.at.getTime(),
    );
    recordCheck(checks, "resolution_mark_before_staff_dismissal", result);

    caseRecord = await resetCase(observer, "dismissmarkfirst", {
      status: "IN_DISCUSSION",
      discussionStartedAt: new Date(Date.now() - 60_000),
      escalateUnlocksAt: new Date(Date.now() + 60_000),
    });
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) => attemptStaffDismissal(tx, caseRecord.id),
      secondWork: (tx) => attemptBuyerMarkResolved(tx, caseRecord.id),
    });
    assert.equal(result.firstResult.outcome, "resolved");
    assert.equal(result.secondResult.outcome, "rejected_status");
    recordCheck(checks, "staff_dismissal_before_resolution_mark", result);

    caseRecord = await resetCase(observer, "dismissreplyfirst", {
      status: "IN_DISCUSSION",
      discussionStartedAt: new Date(Date.now() - 60_000),
      escalateUnlocksAt: new Date(Date.now() + 60_000),
    });
    result = await runContendedOrdering({
      observer,
      firstClient: first,
      secondClient: second,
      secondApplicationName: "case-lifecycle-proof-second",
      firstWork: (tx) => attemptStaffDismissal(tx, caseRecord.id),
      secondWork: (tx) =>
        attemptReply(tx, {
          actorId: ids.seller,
          body: "Reply loses after staff dismissal.",
          suffix: "dismissreplyfirst-second",
        }),
    });
    assert.equal(result.firstResult.outcome, "resolved");
    assert.equal(result.secondResult.outcome, "rejected_status");
    recordCheck(checks, "staff_dismissal_before_reply", result);

    assert.equal(checks.length, 21);
    assert.ok(checks.every((check) => check.lockWaitObserved));
    return {
      checks,
      database: DATABASE_NAME,
      persistentStagingChanged: false,
      productionChanged: false,
      status: "passed",
    };
  } finally {
    await cleanupFixtures(observer).catch(() => {});
    await Promise.allSettled([
      observer.$disconnect(),
      first.$disconnect(),
      second.$disconnect(),
    ]);
  }
}

export async function main(env = process.env) {
  const result = await runProof(parseProofConfig(env));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `Case lifecycle PostgreSQL proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  });
}

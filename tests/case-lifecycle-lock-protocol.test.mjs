import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function assertOrdered(text, labels) {
  let previous = -1;
  for (const [label, needle] of labels) {
    const index = text.indexOf(needle);
    assert.ok(index >= 0, `${label} is missing`);
    assert.ok(index > previous, `${label} is out of order`);
    previous = index;
  }
}

describe("Case and Order lifecycle lock protocol", () => {
  it("uses exact row locks with no broad table authority", () => {
    const locks = source("src/lib/caseLifecycleLocks.ts");

    assert.match(
      locks,
      /SELECT id\s+FROM "User"\s+WHERE id = \$\{userId\}\s+FOR SHARE/s,
    );
    assert.match(
      locks,
      /SELECT id\s+FROM "Order"\s+WHERE id = \$\{orderId\}\s+FOR UPDATE/s,
    );
    assert.match(
      locks,
      /SELECT id\s+FROM "Case"\s+WHERE id = \$\{caseId\}\s+FOR UPDATE/s,
    );
    assert.doesNotMatch(locks, /FOR UPDATE SKIP LOCKED|WHERE id IS NOT NULL/);
    assert.match(locks, /SELECT clock_timestamp\(\) AS now/);
  });

  it("locks and rechecks the Order before atomically creating and auditing a Case", () => {
    const route = source("src/app/api/cases/route.ts");

    assertOrdered(route, [
      ["transaction", "await prisma.$transaction(async (tx) =>"],
      ["Order lock", "await lockOrderForCaseLifecycle(tx, orderId)"],
      ["fresh Order read", "await tx.order.findUnique"],
      ["Case create", "await tx.case.create"],
      ["strict user audit", "await logUserAuditActionOrThrow"],
      ["seller notification", "await createNotification"],
    ]);
    assert.match(route, /order\.items\.some\(\(item\) => item\.listing\.seller\.user\.id !== sellerId\)/);
    assert.match(route, /if \(sellerId === me\.id\)/);
    assert.match(route, /orderHasRefundLedger\(order\) \|\| order\.sellerRefundId/);
    assert.match(
      route,
      /order\.labelStatus === "PURCHASED"[\s\S]{0,120}fulfillmentStatus === "PENDING"/,
    );
  });

  it("takes the same Order lock before label, fulfillment, delivery confirmation, and refund reservations", () => {
    const label = source("src/app/api/orders/[id]/label/route.ts");
    const fulfillment = source("src/app/api/orders/[id]/fulfillment/route.ts");
    const confirmDelivery = source(
      "src/app/api/orders/[id]/confirm-delivery/route.ts",
    );
    const refund = source("src/app/api/orders/[id]/refund/route.ts");

    assertOrdered(label, [
      ["label transaction", "const labelLockResult = await prisma.$transaction"],
      ["label Order lock", "await lockOrderForCaseLifecycle(tx, order.id)"],
      ["label reservation", 'UPDATE "Order"'],
    ]);
    assertOrdered(fulfillment, [
      ["fulfillment transaction", "const transition = await prisma.$transaction"],
      ["fulfillment Order lock", "await lockOrderForCaseLifecycle(tx, id)"],
      [
        "fulfillment post-lock timestamp",
        "const transitionAt = await databaseClockTimestamp(tx)",
      ],
      ["fulfillment transition", 'UPDATE "Order"'],
    ]);
    assertOrdered(confirmDelivery, [
      [
        "delivery-confirmation transaction",
        "const updatedCount = await prisma.$transaction",
      ],
      [
        "delivery-confirmation Order lock",
        "await lockOrderForCaseLifecycle(tx, id)",
      ],
      [
        "delivery-confirmation post-lock timestamp",
        "const deliveredAt = await databaseClockTimestamp(tx)",
      ],
      [
        "delivery-confirmation transition",
        "await tx.order.updateMany",
      ],
    ]);
    assertOrdered(refund, [
      ["refund transaction", "const lockResult = await prisma.$transaction"],
      ["refund Order lock", "await lockOrderForCaseLifecycle(tx, orderId)"],
      [
        "refund post-lock timestamp",
        "const lockedAt = await databaseClockTimestamp(tx)",
      ],
      ["refund reservation", 'UPDATE "Order"'],
    ]);
  });

  it("locks seller User before Order and Case authority in refund finalization", () => {
    const refund = source("src/app/api/orders/[id]/refund/route.ts");
    const finalization = refund.slice(
      refund.indexOf("const refundWrite = await prisma.$transaction"),
    );

    assertOrdered(finalization, [
      [
        "seller User lock",
        "await lockUserForCaseLifecycle(tx, me.id)",
      ],
      ["Order completion", "const orderUpdate = await tx.order.updateMany"],
      ["payment evidence", "await recordLocalRefundEvidence(tx, {"],
      [
        "Case authority",
        "FROM public.grainline_case_seller_refund_apply(",
      ],
    ]);
  });

  it("serializes participant escalation and co-commits its actor audit", () => {
    const route = source("src/app/api/cases/[id]/escalate/route.ts");
    const single = route.slice(route.indexOf("// Single case escalation"));

    assertOrdered(single, [
      ["single-case transaction", "const result = await prisma.$transaction"],
      ["Case lock", "await lockCaseForLifecycle(tx, id)"],
      ["fresh Case read", "await tx.case.findUnique"],
      [
        "post-lock timestamp",
        "const transitionAt = await databaseClockTimestamp(tx)",
      ],
      ["Case transition", "await tx.case.updateMany"],
      ["strict user audit", "await logUserAuditActionOrThrow"],
    ]);
    assert.match(single, /metadata: \{[\s\S]{0,180}orderId: caseRecord\.orderId/);
    assert.doesNotMatch(
      single,
      /:\s*await prisma\.case\.updateMany\(\{\s*where: \{ id, status:/s,
    );
  });

  it("serializes different Case replies on the parent and shares one database timestamp", () => {
    const route = source("src/app/api/cases/[id]/messages/route.ts");
    const write = route.slice(
      route.indexOf("const messageResult = await prisma.$transaction"),
    );

    assertOrdered(write, [
      ["Case lock", "await lockCaseForLifecycle(tx, id)"],
      ["fresh Case read", "tx.case.findUnique"],
      ["fresh actor read", "tx.user.findUnique"],
      [
        "database timestamp",
        "const transitionAt = await databaseClockTimestamp(tx)",
      ],
      ["Case update", "await tx.case.update"],
      ["message create", "await tx.caseMessage.create"],
      ["notification boundary", "// Notify the appropriate party/parties"],
    ]);
    assert.match(write, /updatedAt: transitionAt/);
    assert.match(write, /createdAt: transitionAt/);
    assert.match(
      write,
      /lockedActsAsStaff = lockedIsStaff && !lockedIsParty/,
    );
    assert.match(
      write,
      /lockedActsAsStaff && !nonPartyStaffPinVerified/,
    );
    assert.doesNotMatch(write, /CASE_STATUS_CHANGED|tx\.case\.updateMany/);
  });

  it("locks Order then Case for participant resolution marks and staff resolution", () => {
    const markResolved = source(
      "src/app/api/cases/[id]/mark-resolved/route.ts",
    );
    const staffResolve = source("src/app/api/cases/[id]/resolve/route.ts");
    const markWrite = markResolved.slice(
      markResolved.indexOf("const result = await prisma.$transaction"),
    );
    const staffWrite = staffResolve.slice(
      staffResolve.indexOf("const caseWrite = await prisma.$transaction"),
    );

    assertOrdered(markWrite, [
      ["mark transaction", "const result = await prisma.$transaction"],
      ["mark Order lock", "await lockOrderForCaseLifecycle"],
      ["mark Case lock", "await lockCaseForLifecycle"],
      ["mark fresh Case read", "await tx.case.findUnique"],
      [
        "mark post-lock timestamp",
        "const transitionAt = await databaseClockTimestamp(tx)",
      ],
      ["mark transition", 'UPDATE "Case"'],
      ["mark audit", "await logAdminActionOrThrow"],
    ]);
    assert.match(markWrite, /if \(lockedOrder\.sellerRefundId\)/);
    assert.match(markWrite, /"updatedAt" = \$\{transitionAt\}/);

    assertOrdered(staffWrite, [
      ["staff transaction", "const caseWrite = await prisma.$transaction"],
      ["staff Order lock", "await lockOrderForCaseLifecycle"],
      ["staff Case lock", "await lockCaseForLifecycle"],
      ["staff fresh Case read", "await tx.case.findUnique"],
      ["staff fresh actor read", "await tx.user.findUnique"],
      [
        "staff post-lock timestamp",
        "const transitionAt = await databaseClockTimestamp(tx)",
      ],
      ["staff Case transition", "const caseUpdate = await tx.case.updateMany"],
      [
        "staff resolution message",
        "const resolutionMessage = await tx.caseMessage.create",
      ],
      ["staff audit", "await logAdminActionOrThrow"],
    ]);
    assert.match(staffWrite, /createdAt: transitionAt/);
    assert.match(staffWrite, /resolvedAt: transitionAt/);
    assert.match(staffWrite, /updatedAt: transitionAt/);
    assert.match(staffWrite, /CASE_RESOLUTION_AUTHORITY_CHANGED/);
  });

  it("uses per-row PostgreSQL clock time for bulk cron escalation", () => {
    const route = source("src/app/api/cases/[id]/escalate/route.ts");
    const bulk = route.slice(
      route.indexOf("// Bulk escalation: staff/cron only"),
      route.indexOf("// Single case escalation"),
    );

    assert.match(bulk, /UPDATE "Case"/);
    assert.match(bulk, /"updatedAt" = pg_catalog\.clock_timestamp\(\)/);
    assert.match(
      bulk,
      /"sellerRespondBy" < pg_catalog\.clock_timestamp\(\)/,
    );
    assert.match(
      bulk,
      /"escalateUnlocksAt" < pg_catalog\.clock_timestamp\(\)/,
    );
    assert.doesNotMatch(bulk, /const now = new Date\(\)/);
  });
});

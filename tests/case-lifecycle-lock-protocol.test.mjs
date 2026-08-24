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
  it("uses exact production row locks and keeps the retired Case lock proof-local", () => {
    const locks = source("src/lib/caseLifecycleLocks.ts");
    const lifecycleProof = source("scripts/case-lifecycle-postgres-proof.mjs");

    assert.match(
      locks,
      /SELECT id\s+FROM "User"\s+WHERE id = \$\{userId\}\s+FOR SHARE/s,
    );
    assert.match(
      locks,
      /SELECT id\s+FROM "Order"\s+WHERE id = \$\{orderId\}\s+FOR UPDATE/s,
    );
    assert.match(
      lifecycleProof,
      /SELECT id\s+FROM "Case"\s+WHERE id = \$\{caseId\}\s+FOR UPDATE/s,
    );
    assert.doesNotMatch(locks, /FROM "Case"/);
    assert.doesNotMatch(locks, /FOR UPDATE SKIP LOCKED|WHERE id IS NOT NULL/);
    assert.doesNotMatch(
      lifecycleProof,
      /FOR UPDATE SKIP LOCKED|WHERE id IS NOT NULL/,
    );
    assert.match(locks, /SELECT clock_timestamp\(\) AS now/);
  });

  it("delegates atomic buyer Case creation to the fixed database authority", () => {
    const route = source("src/app/api/cases/route.ts");

    assertOrdered(route, [
      ["fixed authority", "await openCaseWithFixedAuthority({"],
      ["replay stop", 'if (result.action === "replay")'],
      ["seller notification", "await createNotification"],
    ]);
    assert.doesNotMatch(route, /prisma\.\$transaction/);
    assert.doesNotMatch(route, /lockOrderForCaseLifecycle/);
    assert.doesNotMatch(route, /(?:prisma|tx)\.(?:case|caseMessage)\./);

    const migration = source(
      "prisma/migrations/20260729051000_prepare_case_open_authority/migration.sql",
    );
    assertOrdered(migration, [
      ["buyer User lock", "FROM public.\"User\" AS actor"],
      ["Order lock", "FROM public.\"Order\" AS orders"],
      ["seller relationship locks", "FOR SHARE OF item, listing, seller"],
      ["existing Case lock", "FROM public.\"Case\" AS case_row"],
      ["Case create", "INSERT INTO public.\"Case\""],
      ["opening message", "INSERT INTO public.\"CaseMessage\""],
      ["strict audit", "INSERT INTO public.\"AdminAuditLog\""],
      ["private replay ledger", "INSERT INTO public.\"CaseOpenApplication\""],
    ]);
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
      ["refund database claim", "const refundClaim = await claimSellerOrderRefund"],
      ["refund provider outcome", "await resolveOrderRefundProviderOutcome(refundClaim)"],
    ]);
    const refundFinalization = source(
      "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql",
    ).slice(
      source(
        "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql",
      ).indexOf("-- Mutable actor posture is required only"),
    );
    assert.match(
      refundFinalization,
      /orders\."refundClaimGeneration" = p_claim_generation/,
      "refund finalization must retain the exact generation predicate",
    );
    const refundClaimMigration = source(
      "prisma/migrations/20260824010000_prepare_order_refund_claim_generation/migration.sql",
    );
    assertOrdered(refundClaimMigration, [
      ["refund actor lock", 'FROM public."User" AS actor'],
      ["refund seller lock", 'FROM public."SellerProfile" AS seller'],
      ["refund Order lock", 'FROM public."Order" AS orders'],
      ["refund provider authorization", '"refundClaimProviderAuthorizedAt" = transition_at'],
    ]);
  });

  it("locks seller User before Order and Case authority in refund finalization", () => {
    const refundAuthority = source(
      "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql",
    );
    const finalization = refundAuthority.slice(
      refundAuthority.indexOf("-- Mutable actor posture is required only"),
      refundAuthority.indexOf(
        "CREATE FUNCTION public.grainline_blocked_checkout_refund_record",
      ),
    );

    assertOrdered(finalization, [
      ["seller User lock", 'FROM public."User" AS actor'],
      ["Order lock", 'FROM public."Order" AS orders'],
      ["payment evidence", 'INSERT INTO public."OrderPaymentEvent"'],
      [
        "Case authority",
        "FROM public.grainline_case_seller_refund_apply(",
      ],
    ]);
  });

  it("serializes participant escalation and co-commits its actor audit", () => {
    const route = source("src/app/api/cases/[id]/escalate/route.ts");
    const migration = source(
      "prisma/migrations/20260729060000_prepare_case_escalation_cron_authority/migration.sql",
    );
    const single = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.grainline_case_escalate"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.grainline_case_cron_transition_batch"),
    );

    assertOrdered(single, [
      ["actor User lock", 'FROM public."User" AS actor'],
      ["stable party locks", 'FROM public."User" AS party'],
      ["Order lock", 'FROM public."Order" AS orders'],
      [
        "Case lock",
        'WHERE case_row.id = p_case_id\n     AND case_row."orderId" = locked_order.id',
      ],
      ["post-lock timestamp", "transition_at := pg_catalog.timezone("],
      ["Case transition", 'UPDATE public."Case" AS case_row'],
      ["staff audit", 'INSERT INTO public."SystemAuditLog"'],
      ["participant audit", 'INSERT INTO public."AdminAuditLog"'],
    ]);
    assert.match(single, /locked_case\."escalateUnlocksAt" > transition_at/);
    assert.match(single, /"caseResolutionClaimId" IS NOT NULL/);
    assert.match(route, /await escalateCaseWithFixedAuthority\(\{/);
    assert.doesNotMatch(
      route,
      /\bprisma\.|verifyCronRequest|id === "all"/,
    );
  });

  it("serializes different Case replies on the parent and shares one database timestamp", () => {
    const route = source("src/app/api/cases/[id]/messages/route.ts");
    const migration = source(
      "prisma/migrations/20260729052000_prepare_case_reply_authority/migration.sql",
    );

    assertOrdered(migration, [
      ["actor User lock", 'FROM public."User" AS actor'],
      ["parent Case lock", 'FROM public."Case" AS case_row'],
      ["database timestamp", "transition_at := pg_catalog.timezone("],
      ["replay serialization", "pg_catalog.pg_advisory_xact_lock("],
      ["Case update", 'UPDATE public."Case"'],
      ["message create", 'INSERT INTO public."CaseMessage"'],
    ]);
    assert.match(migration, /"updatedAt" = transition_at/);
    assert.match(migration, /transition_at\s*\);/);
    assert.match(
      migration,
      /actor_acts_as_staff :=\s*NOT actor_is_party/,
    );
    assertOrdered(route, [
      ["staff PIN", "await requireStaffAdminPinForApi(req, userId, sessionId)"],
      ["fixed authority", "await replyToCaseWithFixedAuthority({"],
      ["notification boundary", "// Notify the appropriate party/parties"],
    ]);
    assert.doesNotMatch(route, /prisma\.\$transaction|tx\.(?:case|caseMessage)/);
  });

  it("locks Order then Case for participant resolution marks and staff resolution", () => {
    const markResolved = source(
      "src/app/api/cases/[id]/mark-resolved/route.ts",
    );
    const markAuthority = source(
      "prisma/migrations/20260729050000_prepare_case_participant_resolution_authority/migration.sql",
    ).replace(/\s+/g, " ");
    const staffResolve = source("src/app/api/cases/[id]/resolve/route.ts");
    const staffAuthority = source(
      "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
    ).replace(/\s+/g, " ");
    assertOrdered(markAuthority, [
      [
        "mark actor lock",
        'FROM public."User" AS actor WHERE actor.id = p_actor_user_id FOR SHARE',
      ],
      [
        "mark Order lock",
        'FROM public."Order" AS orders WHERE orders.id = source_order_id FOR UPDATE',
      ],
      [
        "mark Case lock",
        'FROM public."Case" AS case_row WHERE case_row.id = p_case_id AND case_row."orderId" = locked_order.id FOR UPDATE',
      ],
      [
        "mark post-lock timestamp",
        "transition_at := pg_catalog.timezone( 'UTC', pg_catalog.clock_timestamp() )",
      ],
    ]);
    const markTransition = markAuthority.slice(
      markAuthority.indexOf('UPDATE public."Case" AS case_row'),
    );
    assertOrdered(markTransition, [
      ["mark transition", 'UPDATE public."Case" AS case_row'],
      ["mark audit", 'INSERT INTO public."AdminAuditLog"'],
      ["mark result", "RETURN pg_catalog.jsonb_build_object"],
    ]);
    assert.match(
      markResolved,
      /await markCaseParticipantResolved\(\{[\s\S]*actorUserId: me\.id,[\s\S]*caseId: id/,
    );
    assert.doesNotMatch(markResolved, /prisma\.\$transaction/);
    assert.match(
      markAuthority,
      /locked_order\."sellerRefundId" IS NOT NULL OR locked_order\."caseResolutionClaimId" IS NOT NULL/,
    );
    assert.match(markAuthority, /"updatedAt" = transition_at/);

    assertOrdered(staffResolve, [
      ["staff prepare", "await prepareCaseStaffResolution("],
      ["staff provider", "await createMarketplaceRefund("],
      ["staff provider record", "await recordCaseStaffResolutionProvider("],
      [
        "staff finalize and durable delivery",
        "await finalizeCaseStaffResolutionWithSideEffects(",
      ],
    ]);
    assertOrdered(staffAuthority, [
      [
        "staff Order lock",
        'FROM public."Order" AS orders WHERE orders.id = source_order_id FOR UPDATE',
      ],
      [
        "staff Case lock",
        'FROM public."Case" AS case_row WHERE case_row.id = p_case_id AND case_row."orderId" = locked_order.id',
      ],
      [
        "staff post-lock timestamp",
        "transition_at := pg_catalog.clock_timestamp()",
      ],
    ]);
    assert.match(staffAuthority, /INSERT INTO public\."CaseMessage"/);
    assert.match(staffAuthority, /INSERT INTO public\."AdminAuditLog"/);
    assert.match(staffAuthority, /resolvedAt" = transition_at/);
    assert.doesNotMatch(staffResolve, /prisma\.\$transaction/);
  });

  it("derives bounded cron targets and co-commits audit and notifications", () => {
    const migration = source(
      "prisma/migrations/20260729060000_prepare_case_escalation_cron_authority/migration.sql",
    );
    const cron = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.grainline_case_cron_transition_batch"),
    );

    assertOrdered(cron, [
      ["database clock", "transition_at := pg_catalog.timezone("],
      ["database-selected candidates", 'FROM public."Case" AS case_row'],
      ["stable party locks", 'FROM public."User" AS party'],
      ["Order skip lock", "FOR UPDATE SKIP LOCKED"],
      [
        "Case skip lock",
        'WHERE case_row.id = candidate.id\n       AND case_row."orderId" = locked_order.id',
      ],
      ["Case transition", 'UPDATE public."Case" AS case_row'],
      ["per-row audit", 'INSERT INTO public."SystemAuditLog"'],
      [
        "atomic Notification",
        "public.grainline_notification_create_case_event(",
      ],
    ]);
    assert.match(cron, /p_limit > 100/);
    assert.match(cron, /transition_at - INTERVAL '7 days'/);
    assert.match(cron, /transition_at - INTERVAL '30 days'/);
    assert.match(cron, /"sellerRespondBy" < transition_cutoff/);
    assert.match(cron, /"caseResolutionClaimId" IS NOT NULL/);
    assert.match(cron, /'case_system_action'/);
  });
});

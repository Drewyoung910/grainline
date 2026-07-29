const freezeOperation = (operation) => Object.freeze({
  ...operation,
  callerInputs: Object.freeze([...operation.callerInputs]),
  databaseDerived: Object.freeze([...operation.databaseDerived]),
  applicationPreconditions: Object.freeze([
    ...(operation.applicationPreconditions ?? []),
  ]),
  externalTrustBoundaries: Object.freeze([
    ...(operation.externalTrustBoundaries ?? []),
  ]),
});

export const CASE_AUTHORITY_OPERATIONS = Object.freeze([
  freezeOperation({
    id: "case_get",
    candidateFunctionName: "grainline_case_get",
    operationKind: "READ_PROJECTION",
    security: "INVOKER",
    runtimeExecute: true,
    callerInputs: ["actorUserId", "caseId"],
    applicationPreconditions: [
      "a non-party staff actor completed the session-bound staff PIN challenge",
    ],
    databaseDerived: ["current actor role", "Case participation", "visible Case projection"],
  }),
  freezeOperation({
    id: "case_get_by_order",
    candidateFunctionName: "grainline_case_get_by_order",
    operationKind: "READ_PROJECTION",
    security: "INVOKER",
    runtimeExecute: true,
    callerInputs: ["actorUserId", "orderId"],
    applicationPreconditions: [
      "a non-party staff actor completed the session-bound staff PIN challenge",
    ],
    databaseDerived: ["current actor role", "Case participation", "visible Case projection"],
  }),
  freezeOperation({
    id: "case_message_page",
    candidateFunctionName: "grainline_case_message_page",
    operationKind: "READ_PROJECTION",
    security: "INVOKER",
    runtimeExecute: true,
    callerInputs: ["actorUserId", "caseId", "createdAtCursor", "idCursor", "boundedLimit"],
    applicationPreconditions: [
      "a non-party staff actor completed the session-bound staff PIN challenge",
    ],
    databaseDerived: [
      "current actor role",
      "Case participation",
      "stable message order",
      "attachment metadata without object keys",
    ],
  }),
  freezeOperation({
    id: "case_staff_queue",
    candidateFunctionName: "grainline_case_staff_queue",
    operationKind: "READ_PROJECTION",
    security: "INVOKER",
    runtimeExecute: true,
    callerInputs: ["actorUserId", "statusFilter", "cursor", "boundedLimit"],
    applicationPreconditions: [
      "the staff actor completed the session-bound staff PIN challenge",
    ],
    databaseDerived: ["current staff role", "bounded queue rows", "message counts"],
  }),
  freezeOperation({
    id: "case_staff_active_count",
    candidateFunctionName: "grainline_case_staff_active_count",
    operationKind: "READ_PROJECTION",
    security: "INVOKER",
    runtimeExecute: true,
    callerInputs: ["actorUserId"],
    applicationPreconditions: [
      "the staff actor completed the session-bound staff PIN challenge",
    ],
    databaseDerived: ["current staff role", "active Case count"],
  }),
  freezeOperation({
    id: "case_export",
    candidateFunctionName: "grainline_case_export",
    operationKind: "READ_PROJECTION",
    security: "INVOKER",
    runtimeExecute: true,
    callerInputs: ["actorUserId"],
    databaseDerived: [
      "participant Cases",
      "complete CaseMessage history",
      "attachment metadata without object keys",
    ],
  }),
  freezeOperation({
    id: "case_message_preflight",
    candidateFunctionName: "grainline_case_message_preflight",
    operationKind: "SOURCE_BOUND_READ",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["actorUserId", "caseId"],
    applicationPreconditions: [
      "a non-party staff actor completed the session-bound staff PIN challenge",
    ],
    databaseDerived: [
      "current actor role",
      "participant or staff authority",
      "messageable status",
      "counterparty availability",
    ],
  }),
  freezeOperation({
    id: "case_attachment_read",
    candidateFunctionName: "grainline_direct_upload_case_attachment_read",
    operationKind: "SOURCE_BOUND_READ",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["actorUserId", "caseId", "attachmentId"],
    applicationPreconditions: [
      "a non-party staff actor completed the session-bound staff PIN challenge",
    ],
    databaseDerived: [
      "current actor role",
      "Case participation",
      "attachment-to-message-to-Case binding",
      "private object metadata",
    ],
  }),
  freezeOperation({
    id: "case_order_active",
    candidateFunctionName: "grainline_case_order_active",
    operationKind: "BOUNDED_PREDICATE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["orderId"],
    databaseDerived: ["whether the exact Order has an active Case"],
  }),
  freezeOperation({
    id: "case_seller_active_count",
    candidateFunctionName: "grainline_case_seller_active_count",
    operationKind: "BOUNDED_AGGREGATE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["sellerProfileId"],
    databaseDerived: [
      "exact SellerProfile user",
      "active unresolved Case count only",
    ],
  }),
  freezeOperation({
    id: "case_seller_verification_eligibility",
    candidateFunctionName: "grainline_case_seller_verification_eligibility",
    operationKind: "BOUNDED_AGGREGATE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["actorUserId", "sellerProfileId", "createdBefore"],
    applicationPreconditions: [
      "a staff actor completed the session-bound staff PIN challenge",
    ],
    databaseDerived: [
      "exact SellerProfile user",
      "current actor is that seller or current staff",
      "aged unresolved Case count only",
    ],
  }),
  freezeOperation({
    id: "case_guild_unresolved_guard",
    candidateFunctionName: "grainline_case_guild_unresolved_guard",
    operationKind: "BOUNDED_PREDICATE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["sellerProfileId", "caseCreatedBefore"],
    applicationPreconditions: [
      "the caller is the authenticated guild cron or a PIN-verified staff reinstatement path",
    ],
    databaseDerived: [
      "exact SellerProfile user and current guild or reinstatement state",
      "whether an aged unresolved Case exists",
    ],
  }),
  freezeOperation({
    id: "case_account_deletion_blockers",
    candidateFunctionName: "grainline_case_account_deletion_blockers",
    operationKind: "BOUNDED_AGGREGATE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["deletingUserId"],
    databaseDerived: ["active participant Case blocker count"],
  }),
  freezeOperation({
    id: "case_open",
    candidateFunctionName: "grainline_case_open",
    operationKind: "WRITE_SERVICE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["actorUserId", "orderId", "reason", "sanitizedDescription"],
    databaseDerived: [
      "locked Order",
      "buyer and one distinct seller",
      "eligibility and refund state",
      "database-generated Case, opening message and audit identities",
      "timestamps and seller response deadline",
      "opening BUYER author kind and message",
      "strict audit target and metadata",
    ],
    externalTrustBoundaries: [
      "Order relationship and payment-state integrity remains a dependency of the later order-payment RLS group",
    ],
  }),
  freezeOperation({
    id: "case_reply",
    candidateFunctionName: "grainline_case_reply",
    operationKind: "WRITE_SERVICE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: [
      "actorUserId",
      "caseId",
      "sanitizedBody",
      "boundedDirectUploadIds",
    ],
    applicationPreconditions: [
      "a non-party staff actor completed the session-bound staff PIN challenge",
    ],
    databaseDerived: [
      "locked Case and current actor",
      "participant or staff authority",
      "author kind",
      "status transition and timestamp",
      "database-generated message, attachment and audit identities",
      "idempotent replay identity",
      "attachment ownership, metadata and exclusive Case binding",
    ],
  }),
  freezeOperation({
    id: "case_mark_resolved",
    candidateFunctionName: "grainline_case_mark_resolved",
    operationKind: "WRITE_SERVICE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["actorUserId", "caseId"],
    databaseDerived: [
      "current non-banned and non-deleted participant actor",
      "locked Order then Case",
      "participant side",
      "seller-refund and every staged staff-resolution claim conflict",
      "PENDING_CLOSE or mutual DISMISSED transition",
      "post-lock UTC transition timestamp, deterministic strict audit and stable replay identity",
    ],
  }),
  freezeOperation({
    id: "case_escalate",
    candidateFunctionName: "grainline_case_escalate",
    operationKind: "WRITE_SERVICE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["actorUserId", "caseId"],
    applicationPreconditions: [
      "a non-party staff actor completed the session-bound staff PIN challenge",
    ],
    databaseDerived: [
      "locked Case and current actor",
      "participant eligibility or current staff role",
      "counterparty availability",
      "UNDER_REVIEW transition timestamp and database-generated strict audit",
    ],
  }),
  freezeOperation({
    id: "case_staff_resolution_prepare",
    candidateFunctionName: "grainline_case_staff_resolution_prepare",
    operationKind: "WRITE_SERVICE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: [
      "actorUserId",
      "caseId",
      "staffResolution",
      "boundedPartialRefundAmount",
      "boundedStockRestoreDecision",
    ],
    applicationPreconditions: [
      "the staff actor completed the session-bound staff PIN challenge",
    ],
    databaseDerived: [
      "current staff role",
      "locked Order then Case",
      "resolution eligibility",
      "refund amount cap",
      "stock restoration targets and quantities from locked Order items",
      "database-generated resolution claim identity",
      "refund lease and provider idempotency scope bound to the claim",
    ],
    externalTrustBoundaries: [
      "Stripe execution remains outside PostgreSQL and must use the returned idempotency scope",
    ],
  }),
  freezeOperation({
    id: "case_staff_resolution_finalize",
    candidateFunctionName: "grainline_case_staff_resolution_finalize",
    operationKind: "WRITE_SERVICE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: [
      "actorUserId",
      "resolutionClaimId",
    ],
    applicationPreconditions: [
      "the staff actor completed the session-bound staff PIN challenge",
      "the application recorded bounded provider evidence through the fixed provider-record operation before finalization when the claim requires a refund",
    ],
    databaseDerived: [
      "current staff role",
      "claimed Case, Order, resolution choice and bounded stock decision",
      "resolution claim is held by the exact same staff actor",
      "held refund lease bound to the resolution claim or non-refund guard",
      "exact claim-linked durable local OrderPaymentEvent and audit evidence when refunding",
      "RESOLVED fields and timestamp",
      "fixed STAFF resolution message",
      "database-generated message and strict audit identities",
      "stock restoration targets",
    ],
    externalTrustBoundaries: [
      "the local payment ledger records the trusted Stripe client result; PostgreSQL does not independently attest Stripe",
      "Order and OrderPaymentEvent direct-write hardening remains a dependency of the later order-payment RLS group",
    ],
  }),
  freezeOperation({
    id: "case_staff_resolution_provider_record",
    candidateFunctionName: "grainline_case_staff_resolution_provider_record",
    operationKind: "WRITE_SERVICE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: [
      "actorUserId",
      "resolutionClaimId",
      "providerOutcome",
      "primaryRefundId",
      "boundedRefundIds",
      "boundedRefundStatuses",
      "optionalTransferReversalId",
      "optionalTransferReversalAmountCents",
      "requiresManualTransferReconciliation",
      "requiresManualFollowUp",
    ],
    applicationPreconditions: [
      "the staff actor completed the session-bound staff PIN challenge",
      "the trusted Stripe client used the exact idempotency scope returned for this resolution claim",
    ],
    databaseDerived: [
      "current staff role and exact same claim actor",
      "locked PROVIDER_PENDING CaseResolutionClaim, Order and Case",
      "claim-bound refund amount, currency, reason and accounting expectations",
      "RECORDED outcome validates bounded provider evidence, creates database-generated OrderPaymentEvent and strict audit identities, and advances to PROVIDER_RECORDED",
      "AMBIGUOUS outcome forbids asserted provider evidence, creates no payment event, and advances to RECONCILIATION_REQUIRED with the Order refund sentinel preserved",
    ],
    externalTrustBoundaries: [
      "the bounded RECORDED or AMBIGUOUS outcome classification comes from the trusted Stripe client",
      "bounded refund and transfer identifiers and statuses for RECORDED come from the trusted Stripe client response",
      "PostgreSQL validates their shape and claim relationship but does not independently attest Stripe",
    ],
  }),
  freezeOperation({
    id: "case_staff_resolution_reconcile",
    candidateFunctionName: "grainline_case_staff_resolution_reconcile",
    operationKind: "WRITE_SERVICE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: [
      "actorUserId",
      "resolutionClaimId",
      "reconciliationAction",
      "boundedReconciliationReason",
    ],
    applicationPreconditions: [
      "an ADMIN actor completed the session-bound staff PIN challenge and explicitly reconciled the provider state",
    ],
    databaseDerived: [
      "current non-banned ADMIN role",
      "locked unresolved CaseResolutionClaim, Order and Case",
      "existing payment-event absence or presence",
      "same claim idempotency scope for retry",
      "RELEASED_NO_PROVIDER_EFFECT terminal state and lease release only for an explicit CONFIRMED_NO_PROVIDER_EFFECT action",
      "database-generated immutable reconciliation audit",
    ],
    externalTrustBoundaries: [
      "an admin confirmation that Stripe has no effect is a human provider-reconciliation decision PostgreSQL cannot attest",
    ],
  }),
  freezeOperation({
    id: "case_stripe_dispute_apply",
    candidateFunctionName: "grainline_case_stripe_dispute_apply",
    operationKind: "WRITE_SERVICE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["orderPaymentEventId"],
    databaseDerived: [
      "exact durable dispute event and Order",
      "buyer and one seller",
      "create or reopen target",
      "source-backed openedByPaymentEventId for a webhook-created Case",
      "UNDER_REVIEW state with stale Case resolution and refund snapshot cleared while durable OrderPaymentEvent history is retained",
      "private CaseStripeDisputeApplication replay identity and co-committed non-authoritative SystemAuditLog observability",
    ],
    externalTrustBoundaries: [
      "the Stripe webhook route verifies the provider signature before recording the OrderPaymentEvent",
      "OrderPaymentEvent direct-write hardening remains a dependency of the later order-payment RLS group",
    ],
  }),
  freezeOperation({
    id: "case_seller_refund_apply",
    candidateFunctionName: "grainline_case_seller_refund_apply",
    operationKind: "WRITE_SERVICE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["actorUserId", "orderPaymentEventId"],
    databaseDerived: [
      "current non-banned and non-deleted seller actor",
      "exact seller-owned Order and complete seller graph",
      "same-Order local refund event whose object id, amount, currency and refund kind match the locked completed Order refund",
      "active, terminal or absent Case disposition",
      "refund resolution fields, timestamp and seller resolver",
      "private CaseSellerRefundApplication replay identity and co-committed non-authoritative SystemAuditLog observability",
    ],
    externalTrustBoundaries: [
      "the local payment ledger records the trusted Stripe client result; PostgreSQL does not independently attest Stripe",
      "Order and OrderPaymentEvent direct-write hardening remains a dependency of the later order-payment RLS group",
      "the compatible application must lock the authenticated seller User before its existing Order refund transaction so the shared User then Order then Case lock order is preserved",
    ],
  }),
  freezeOperation({
    id: "case_cron_transition_batch",
    candidateFunctionName: "grainline_case_cron_transition_batch",
    operationKind: "WRITE_SERVICE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["transitionFamily", "boundedLimit"],
    databaseDerived: [
      "due Case targets selected in stable order with FOR UPDATE SKIP LOCKED",
      "fresh eligibility and database timestamps",
      "status transition and per-row database-generated strict audit",
      "bounded replay-safe audit and recipient metadata for existing Notification wrappers",
    ],
  }),
  freezeOperation({
    id: "case_account_deletion_redact",
    candidateFunctionName: "grainline_case_account_deletion_redact",
    operationKind: "LIFECYCLE_WRITE",
    security: "DEFINER",
    runtimeExecute: true,
    callerInputs: ["accountDeletionSideEffectId"],
    databaseDerived: [
      "locked LOCAL_ANONYMIZE side effect and deleting account",
      "account sensitive values",
      "participant Cases",
      "authored messages and bounded counterparty matches",
      "fixed redaction text",
    ],
    applicationPreconditions: [
      "the account-deletion route or retry worker completed its existing re-verification and provider-side deletion boundary",
    ],
    externalTrustBoundaries: [
      "AccountDeletionSideEffect direct-write hardening remains a dependency of its later service-ledger review",
    ],
  }),
  freezeOperation({
    id: "case_lock_core",
    candidateFunctionName: "grainline_case_lock_core",
    operationKind: "PRIVATE_CORE",
    security: "DEFINER",
    runtimeExecute: false,
    callerInputs: ["caseId"],
    databaseDerived: ["exact Case row lock"],
  }),
]);

const freezeSource = (entry) => Object.freeze({
  actors: Object.freeze([...entry.actors]),
  destinations: Object.freeze([...entry.destinations]),
  inventory: Object.freeze({ ...entry.inventory }),
});

// Once a source has no direct protected-table references, move its former
// inventory here rather than deleting its authority history. The current
// scanner stays an exact activation countdown while this ledger proves which
// fixed operation replaced each removed reference.
export const CASE_CONVERTED_SOURCE_DESTINATIONS = Object.freeze({
  "src/app/api/stripe/webhook/route.ts": freezeSource({
    actors: ["STRIPE_WEBHOOK"],
    destinations: ["case_stripe_dispute_apply"],
    inventory: {
      "Case.updateMany": 1,
      "Case.create": 1,
      "Case.relation-reference": 1,
    },
  }),
  "src/app/api/orders/[id]/refund/route.ts": freezeSource({
    actors: ["SELLER"],
    destinations: ["case_seller_refund_apply"],
    inventory: {
      "Case.findUnique": 1,
      "Case.updateMany": 1,
    },
  }),
  "src/app/api/cases/[id]/resolve/route.ts": freezeSource({
    actors: ["STAFF"],
    destinations: [
      "case_staff_resolution_prepare",
      "case_staff_resolution_provider_record",
      "case_staff_resolution_finalize",
    ],
    inventory: {
      "Case.findUnique": 1,
      "Case.updateMany": 1,
      "CaseMessage.create": 1,
      "Case.findUniqueOrThrow": 1,
    },
  }),
  "src/app/api/cases/[id]/mark-resolved/route.ts": freezeSource({
    actors: ["PARTICIPANT"],
    destinations: ["case_mark_resolved"],
    inventory: {
      "Case.findUnique": 2,
      "Case.raw-sql-reference": 1,
    },
  }),
  "src/app/api/cases/route.ts": freezeSource({
    actors: ["BUYER"],
    destinations: ["case_open"],
    inventory: {
      "Case.create": 1,
      "Case.relation-reference": 1,
      "CaseMessage.relation-reference": 2,
    },
  }),
  "src/app/api/cases/[id]/messages/route.ts": freezeSource({
    actors: ["PARTICIPANT", "STAFF"],
    destinations: ["case_message_preflight", "case_reply"],
    inventory: {
      "Case.findUnique": 2,
      "CaseMessage.findMany": 2,
      "Case.update": 1,
      "CaseMessage.create": 1,
      "CaseMessageAttachment.relation-reference": 5,
    },
  }),
  "src/app/api/cases/[id]/attachments/route.ts": freezeSource({
    actors: ["PARTICIPANT", "STAFF"],
    destinations: ["case_message_preflight"],
    inventory: { "Case.findUnique": 1 },
  }),
});

export const CASE_AUTHORITY_SOURCE_DESTINATIONS = Object.freeze({
  "src/app/admin/cases/[id]/page.tsx": freezeSource({
    actors: ["STAFF"],
    destinations: ["case_get", "case_message_page"],
    inventory: { "Case.findUnique": 1 },
  }),
  "src/app/admin/cases/page.tsx": freezeSource({
    actors: ["STAFF"],
    destinations: ["case_staff_queue"],
    inventory: {
      "Case.count": 1,
      "Case.findMany": 1,
      "CaseMessage.relation-reference": 1,
    },
  }),
  "src/app/admin/layout.tsx": freezeSource({
    actors: ["STAFF"],
    destinations: ["case_staff_active_count"],
    inventory: { "Case.count": 1 },
  }),
  "src/app/admin/verification/page.tsx": freezeSource({
    actors: ["STAFF"],
    destinations: [
      "case_seller_verification_eligibility",
      "case_guild_unresolved_guard",
    ],
    inventory: { "Case.count": 1, "Case.findFirst": 1 },
  }),
  "src/app/api/account/export/route.ts": freezeSource({
    actors: ["PARTICIPANT"],
    destinations: ["case_export"],
    inventory: {
      "Case.findMany": 1,
      "CaseMessage.relation-reference": 1,
      "CaseMessageAttachment.relation-reference": 1,
    },
  }),
  "src/app/api/cases/[id]/attachments/[attachmentId]/route.ts": freezeSource({
    actors: ["PARTICIPANT", "STAFF"],
    destinations: ["case_attachment_read"],
    inventory: { "Case.findUnique": 1 },
  }),
  "src/app/api/cases/[id]/escalate/route.ts": freezeSource({
    actors: ["PARTICIPANT", "STAFF", "CRON"],
    destinations: ["case_escalate", "case_cron_transition_batch"],
    inventory: {
      "Case.findUnique": 1,
      "Case.updateMany": 1,
      "Case.raw-sql-reference": 1,
    },
  }),
  "src/app/api/cases/[id]/resolve/route.ts": freezeSource({
    actors: ["STAFF"],
    destinations: [
      "case_staff_resolution_prepare",
      "case_staff_resolution_provider_record",
      "case_staff_resolution_finalize",
      "case_staff_resolution_reconcile",
    ],
    inventory: {
      "Case.findUnique": 2,
      "CaseMessage.relation-reference": 1,
    },
  }),
  "src/app/api/cron/case-auto-close/route.ts": freezeSource({
    actors: ["CRON"],
    destinations: ["case_cron_transition_batch"],
    inventory: { "Case.updateMany": 3, "Case.findMany": 3 },
  }),
  "src/app/api/cron/guild-member-check/route.ts": freezeSource({
    actors: ["CRON"],
    destinations: ["case_guild_unresolved_guard"],
    inventory: { "Case.findFirst": 1 },
  }),
  "src/app/api/verification/apply/route.ts": freezeSource({
    actors: ["SELLER"],
    destinations: ["case_seller_verification_eligibility"],
    inventory: { "Case.count": 1 },
  }),
  "src/app/dashboard/verification/page.tsx": freezeSource({
    actors: ["SELLER"],
    destinations: ["case_seller_verification_eligibility"],
    inventory: { "Case.count": 1 },
  }),
  "src/lib/accountDeletion.ts": freezeSource({
    actors: ["ACCOUNT_LIFECYCLE"],
    destinations: ["case_account_deletion_blockers", "case_account_deletion_redact"],
    inventory: {
      "CaseMessage.update": 1,
      "Case.update": 1,
      "Case.count": 1,
      "CaseMessage.updateMany": 1,
      "Case.updateMany": 1,
      "CaseMessage.raw-sql-reference": 2,
      "Case.raw-sql-reference": 4,
    },
  }),
  "src/lib/caseMessageHistory.ts": freezeSource({
    actors: ["PARTICIPANT", "STAFF"],
    destinations: ["case_message_page"],
    inventory: {
      "CaseMessage.findMany": 1,
      "CaseMessageAttachment.relation-reference": 1,
    },
  }),
  "src/lib/metrics.ts": freezeSource({
    actors: ["METRICS"],
    destinations: ["case_seller_active_count"],
    inventory: { "Case.count": 1 },
  }),
  "src/app/admin/orders/[id]/page.tsx": freezeSource({
    actors: ["STAFF"],
    destinations: ["case_get_by_order"],
    inventory: { "Case.relation-reference": 1 },
  }),
  "src/app/api/orders/[id]/confirm-delivery/route.ts": freezeSource({
    actors: ["BUYER"],
    destinations: ["case_order_active"],
    inventory: { "Case.relation-reference": 3 },
  }),
  "src/app/api/orders/[id]/fulfillment/route.ts": freezeSource({
    actors: ["SELLER"],
    destinations: ["case_order_active"],
    inventory: {
      "Case.relation-reference": 1,
      "Case.raw-sql-reference": 1,
    },
  }),
  "src/app/api/orders/[id]/label/route.ts": freezeSource({
    actors: ["SELLER"],
    destinations: ["case_order_active"],
    inventory: {
      "Case.relation-reference": 1,
      "Case.raw-sql-reference": 1,
    },
  }),
  "src/app/dashboard/orders/[id]/page.tsx": freezeSource({
    actors: ["BUYER"],
    destinations: ["case_get_by_order", "case_message_page"],
    inventory: { "Case.relation-reference": 1 },
  }),
  "src/app/dashboard/sales/[orderId]/page.tsx": freezeSource({
    actors: ["SELLER"],
    destinations: ["case_get_by_order", "case_message_page"],
    inventory: { "Case.relation-reference": 1 },
  }),
  "src/lib/caseLifecycleLocks.ts": freezeSource({
    actors: ["PRIVATE_CORE"],
    destinations: ["case_lock_core"],
    inventory: { "Case.raw-sql-reference": 1 },
  }),
  "src/lib/orderPiiRetention.ts": freezeSource({
    actors: ["RETENTION_CRON"],
    destinations: ["case_order_active"],
    inventory: { "Case.raw-sql-reference": 1 },
  }),
});

export const CASE_AUTHORITY_OPERATION_IDS = Object.freeze(
  CASE_AUTHORITY_OPERATIONS.map((operation) => operation.id),
);

export function caseAuthorityReferenceCount() {
  return Object.values(CASE_AUTHORITY_SOURCE_DESTINATIONS)
    .reduce(
      (total, source) =>
        total + Object.values(source.inventory)
          .reduce((sourceTotal, count) => sourceTotal + count, 0),
      0,
    );
}

export function caseAuthorityConvertedReferenceCount() {
  return Object.values(CASE_CONVERTED_SOURCE_DESTINATIONS)
    .reduce(
      (total, source) =>
        total + Object.values(source.inventory)
          .reduce((sourceTotal, count) => sourceTotal + count, 0),
      0,
    );
}

import type { ClaimedEmailOutboxJob } from "@/lib/emailOutboxAccess";

export type EmailOutboxProcessResult =
  | "sent"
  | "failed"
  | "capped"
  | "deferred"
  | "unclaimed";

export type EmailOutboxAuthorityOutcome =
  | "applied"
  | "stale_claim"
  | "already_terminal"
  | "missing";

export type EmailOutboxProviderAttemptOutcome =
  | EmailOutboxAuthorityOutcome
  | "ready"
  | "expired";

export type EmailOutboxFailureClass =
  | "provider_retryable"
  | "provider_rejected"
  | "invalid_payload"
  | "configuration"
  | "unexpected_internal";

export type EmailOutboxAllowance = {
  allowed: number;
  counterAvailable: boolean;
};

export type EmailOutboxWorkerDependencies = {
  providerConfigured: boolean;
  reserveRecipient: (
    recipientEmail: string,
    requested: number,
    now: Date,
  ) => Promise<EmailOutboxAllowance>;
  reserveGlobal: (
    lane: ClaimedEmailOutboxJob["lane"],
    requested: number,
    now: Date,
  ) => Promise<EmailOutboxAllowance>;
  rollbackRecipient: (
    recipientEmail: string,
    requested: number,
    now: Date,
  ) => Promise<unknown>;
  rollbackGlobal: (requested: number, now: Date) => Promise<unknown>;
  defer: (
    claim: ClaimedEmailOutboxJob,
    reason:
      | "recipient_optional_quota"
      | "optional_global_quota"
      | "transactional_global_quota"
      | "quota_unavailable"
      | "provider_unavailable",
  ) => Promise<EmailOutboxAuthorityOutcome>;
  beginProviderAttempt: (
    claim: ClaimedEmailOutboxJob,
  ) => Promise<EmailOutboxProviderAttemptOutcome>;
  sendLegacy: (claim: ClaimedEmailOutboxJob) => Promise<string>;
  complete: (
    claim: ClaimedEmailOutboxJob,
    providerMessageId: string,
  ) => Promise<EmailOutboxAuthorityOutcome>;
  fail: (
    claim: ClaimedEmailOutboxJob,
    errorClass: EmailOutboxFailureClass,
    summary: string,
  ) => Promise<EmailOutboxAuthorityOutcome>;
  classifyFailure: (error: unknown) => EmailOutboxFailureClass;
  sanitizeFailure: (error: unknown) => string;
  onFailure?: (
    error: unknown,
    errorClass: EmailOutboxFailureClass,
    claim: ClaimedEmailOutboxJob,
  ) => void;
  now?: () => Date;
};

function appliedResult(
  outcome: EmailOutboxAuthorityOutcome,
  result: EmailOutboxProcessResult,
): EmailOutboxProcessResult {
  return outcome === "applied" ? result : "unclaimed";
}

async function rollbackUnsentReservations({
  claim,
  checkedAt,
  recipientReserved,
  globalReserved,
  dependencies,
}: {
  claim: ClaimedEmailOutboxJob;
  checkedAt: Date;
  recipientReserved: number;
  globalReserved: number;
  dependencies: EmailOutboxWorkerDependencies;
}) {
  await Promise.allSettled([
    dependencies.rollbackRecipient(
      claim.recipientEmail,
      recipientReserved,
      checkedAt,
    ),
    dependencies.rollbackGlobal(globalReserved, checkedAt),
  ]);
}

/**
 * Runs one generation-fenced claim. Eligibility is already enforced by the
 * claim authority, so this layer owns only quotas, the provider boundary, and
 * terminal claim recording.
 */
export async function processClaimedEmailOutboxJob(
  claim: ClaimedEmailOutboxJob,
  dependencies: EmailOutboxWorkerDependencies,
): Promise<EmailOutboxProcessResult> {
  if (claim.legacySubject === null || claim.legacyHtml === null) {
    return appliedResult(
      await dependencies.fail(
        claim,
        "invalid_payload",
        "Structured email payload has no compatible renderer",
      ),
      "failed",
    );
  }

  if (!dependencies.providerConfigured) {
    return appliedResult(
      await dependencies.defer(claim, "provider_unavailable"),
      "deferred",
    );
  }

  const checkedAt = dependencies.now?.() ?? new Date();
  let recipientReserved = 0;
  let globalReserved = 0;
  let providerAttemptStarted = false;

  try {
    if (claim.lane === "OPTIONAL") {
      const recipient = await dependencies.reserveRecipient(
        claim.recipientEmail,
        1,
        checkedAt,
      );
      recipientReserved = recipient.allowed;
      if (recipient.allowed < 1) {
        const reason = recipient.counterAvailable
          ? "recipient_optional_quota"
          : "quota_unavailable";
        return appliedResult(
          await dependencies.defer(claim, reason),
          recipient.counterAvailable ? "capped" : "deferred",
        );
      }
    }

    const global = await dependencies.reserveGlobal(claim.lane, 1, checkedAt);
    globalReserved = global.allowed;
    if (global.allowed < 1) {
      await rollbackUnsentReservations({
        claim,
        checkedAt,
        recipientReserved,
        globalReserved,
        dependencies,
      });
      const reason = !global.counterAvailable
        ? "quota_unavailable"
        : claim.lane === "OPTIONAL"
          ? "optional_global_quota"
          : "transactional_global_quota";
      return appliedResult(
        await dependencies.defer(claim, reason),
        global.counterAvailable ? "capped" : "deferred",
      );
    }

    const begin = await dependencies.beginProviderAttempt(claim);
    if (begin !== "ready") {
      await rollbackUnsentReservations({
        claim,
        checkedAt,
        recipientReserved,
        globalReserved,
        dependencies,
      });
      return "unclaimed";
    }
    providerAttemptStarted = true;

    const providerMessageId = await dependencies.sendLegacy(claim);
    if (!providerMessageId.trim()) {
      throw new TypeError("Email provider returned success without a message id");
    }
    return appliedResult(
      await dependencies.complete(claim, providerMessageId),
      "sent",
    );
  } catch (error) {
    if (!providerAttemptStarted) {
      await rollbackUnsentReservations({
        claim,
        checkedAt,
        recipientReserved,
        globalReserved,
        dependencies,
      });
    }
    const errorClass = dependencies.classifyFailure(error);
    dependencies.onFailure?.(error, errorClass, claim);
    return appliedResult(
      await dependencies.fail(
        claim,
        errorClass,
        dependencies.sanitizeFailure(error),
      ),
      "failed",
    );
  }
}

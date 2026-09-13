import * as Sentry from "@sentry/nextjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";

type SystemAuditLogClient = Pick<Prisma.TransactionClient, "systemAuditLog">;

type SystemAuditLogInput = {
  actorType: "cron" | "webhook" | "system" | "staff" | "user";
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export class SystemAuditLogError extends Error {
  constructor(message = "System audit log failed") {
    super(message);
    this.name = "SystemAuditLogError";
  }
}

async function createSystemAuditLog({
  client = prisma,
  actorType,
  actorId,
  action,
  targetType,
  targetId,
  reason,
  metadata = {},
}: SystemAuditLogInput & { client?: SystemAuditLogClient }): Promise<string> {
  const log = await client.systemAuditLog.create({
    data: {
      actorType,
      actorId: actorId ?? null,
      action,
      targetType,
      targetId,
      reason: reason ? truncateText(sanitizeText(reason), 1000) || null : undefined,
      metadata: metadata as Parameters<typeof prisma.systemAuditLog.create>[0]["data"]["metadata"],
    },
  });
  return log.id;
}

function captureSystemAuditLogFailure(
  error: unknown,
  { actorType, actorId, action, targetType, targetId }: SystemAuditLogInput,
) {
  console.error("System audit log failed:", sanitizeEmailOutboxError(error));
  Sentry.captureException(error, {
    tags: { source: "system_audit_log", actorType, action },
    extra: { actorId, targetType, targetId },
  });
}

export async function logSystemAction(input: SystemAuditLogInput): Promise<string | null> {
  try {
    return await createSystemAuditLog(input);
  } catch (error) {
    captureSystemAuditLogFailure(error, input);
    return null;
  }
}

export async function logSystemActionOrThrow(
  input: SystemAuditLogInput & { client?: SystemAuditLogClient },
): Promise<string> {
  try {
    return await createSystemAuditLog(input);
  } catch (error) {
    captureSystemAuditLogFailure(error, input);
    throw new SystemAuditLogError();
  }
}

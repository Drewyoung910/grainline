import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS } from "@/lib/stripeWebhookEventState";
import { truncateText } from "@/lib/sanitize";

export async function beginStripeWebhookEvent(id: string, type: string): Promise<boolean> {
  const now = new Date();
  try {
    await prisma.stripeWebhookEvent.create({
      data: { id, type, processingStartedAt: now },
    });
    return true;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
  }

  const staleBefore = new Date(Date.now() - STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS);
  const claimed = await prisma.stripeWebhookEvent.updateMany({
    where: {
      id,
      processedAt: null,
      OR: [
        { processingStartedAt: null },
        { processingStartedAt: { lt: staleBefore } },
      ],
    },
    data: {
      type,
      processingStartedAt: now,
      lastError: null,
    },
  });
  return claimed.count > 0;
}

export async function markStripeWebhookEventProcessed(id: string): Promise<void> {
  await prisma.stripeWebhookEvent.update({
    where: { id },
    data: { processedAt: new Date(), lastError: null },
  });
}

export async function markStripeWebhookEventFailed(id: string, error: unknown): Promise<void> {
  await prisma.stripeWebhookEvent.updateMany({
    where: { id, processedAt: null },
    data: {
      processingStartedAt: null,
      lastError: truncateText(error instanceof Error ? error.message : String(error), 500),
    },
  });
}

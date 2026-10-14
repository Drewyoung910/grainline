// src/app/api/cron/guild-member-check/route.ts
// Daily cron — runs every day at 14:10 UTC.
// Checks all Guild Members for revocation triggers:
//   1. Unresolved case older than 90 days
//   2. Active listing count below 5 for 30+ consecutive days

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { userEmailDeliveryRecipient } from "@/lib/userEmailDeliveryAccess";
import { sendGuildMemberRevokedEmail } from "@/lib/email";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import {
  applySellerGuildMemberRevocation,
  sellerGuildMemberCronBatch,
  type SellerGuildMemberCronRow,
} from "@/lib/sellerGuildPrivateAccess";
import { revalidateFeaturedMakerCaches } from "@/lib/searchCache";
import { runCronCursorPages } from "@/lib/cronBatchState";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";
export const maxDuration = 300;

const SELLER_PAGE_SIZE = 50;
const SELLER_PROCESS_CONCURRENCY = 3;

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  return withSentryCronMonitor("guild-member-check", { value: "10 14 * * *", maxRuntimeMinutes: 5 }, async () => {
    const cronRun = await beginCronRun("guild-member-check");
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      const response = await runGuildMemberCheckCron();
      await completeCronRun(cronRun, response);
      return NextResponse.json(response);
    } catch (error) {
      await failCronRun(cronRun, error);
      Sentry.captureException(error, { tags: { source: "cron_guild_member_check" } });
      return NextResponse.json({ error: "Internal server error" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
    }
  });
}

async function runGuildMemberCheckCron() {
  let revokedMember = 0;
  const errors: Array<{ sellerId: string; code: string }> = [];

  await runCronCursorPages({
    pageSize: SELLER_PAGE_SIZE,
    fetchPage: fetchGuildMemberBatch,
    getCursor: (seller) => seller.id,
    processPage: async (sellers) => {
      for (let i = 0; i < sellers.length; i += SELLER_PROCESS_CONCURRENCY) {
        const batch = sellers.slice(i, i + SELLER_PROCESS_CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (seller) => {
            try {
              return await checkGuildMemberSeller(seller);
            } catch (err) {
              const code = getErrorCode(err);
              errors.push({ sellerId: seller.id, code });
              Sentry.captureException(err, { tags: { source: "cron_guild_member_check", sellerId: seller.id, code } });
              return 0;
            }
          }),
        );
        revokedMember += results.reduce((sum, result) => sum + result, 0);
      }
    },
  });

  return { revokedMember, errors };
}

async function fetchGuildMemberBatch(cursorId: string | null) {
  return sellerGuildMemberCronBatch(cursorId, SELLER_PAGE_SIZE);
}

type GuildMemberSeller = SellerGuildMemberCronRow;

async function checkGuildMemberSeller(
  seller: GuildMemberSeller,
): Promise<number> {
  const revocation = await applySellerGuildMemberRevocation(seller.id);
  if (
    !revocation?.applied
    || !revocation.auditId
    || !revocation.reason
    || !revocation.sellerUserId
  ) return 0;
  revalidateFeaturedMakerCaches();

  await createNotification({
    userId: revocation.sellerUserId,
    type: "VERIFICATION_REJECTED",
    title: "Guild Member badge revoked",
    body: revocation.reason,
    link: "/dashboard/verification",
    sourceType: NOTIFICATION_SOURCE_TYPES.GUILD_SYSTEM_ACTION,
    sourceId: revocation.auditId,
  });

  const emailRecipient = await userEmailDeliveryRecipient(prisma, {
    userId: revocation.sellerUserId,
    preferenceKey: "EMAIL_VERIFICATION_REJECTED",
  });
  if (emailRecipient) {
    try {
      await sendGuildMemberRevokedEmail({
        seller: { displayName: emailRecipient.name, email: emailRecipient.email },
        reason: revocation.reason,
      });
    } catch (err) {
      Sentry.captureException(err, { tags: { source: "cron_guild_member_check_revoked_email", sellerId: seller.id } });
    }
  }
  return 1;
}

function getErrorCode(err: unknown): string {
  if (typeof err === "object" && err && "code" in err) {
    return String((err as { code?: unknown }).code ?? "UNKNOWN").slice(0, 64);
  }
  if (err instanceof Error) {
    return err.name.slice(0, 64) || "Error";
  }
  return "UNKNOWN";
}

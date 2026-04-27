// src/app/api/cron/guild-member-check/route.ts
// Daily cron — runs every day at 8am UTC.
// Checks all Guild Members for revocation triggers:
//   1. Unresolved case older than 90 days
//   2. Active listing count below 5 for 30+ consecutive days

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { sendGuildMemberRevokedEmail } from "@/lib/email";
import { verifyCronRequest } from "@/lib/cronAuth";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";

export const runtime = "nodejs";
export const maxDuration = 300;

const SELLER_PAGE_SIZE = 50;
const SELLER_PROCESS_CONCURRENCY = 3;

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cronRun = await beginCronRun("guild-member-check");
  if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

  try {
    const response = await runGuildMemberCheckCron();
    await completeCronRun(cronRun, response);
    return NextResponse.json(response);
  } catch (error) {
    await failCronRun(cronRun, error);
    Sentry.captureException(error, { tags: { source: "cron_guild_member_check" } });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function runGuildMemberCheckCron() {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  let revokedMember = 0;
  const errors: Array<{ sellerId: string; code: string }> = [];

  let cursorId: string | null = null;
  while (true) {
    const sellers = await fetchGuildMemberBatch(cursorId);
    if (sellers.length === 0) break;

    for (let i = 0; i < sellers.length; i += SELLER_PROCESS_CONCURRENCY) {
      const batch = sellers.slice(i, i + SELLER_PROCESS_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (seller) => {
          try {
            return await checkGuildMemberSeller(seller, ninetyDaysAgo, thirtyDaysAgo);
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

    cursorId = sellers[sellers.length - 1]?.id ?? null;
    if (sellers.length < SELLER_PAGE_SIZE) break;
  }

  return { revokedMember, errors };
}

async function fetchGuildMemberBatch(cursorId: string | null) {
  return prisma.sellerProfile.findMany({
    where: {
      guildLevel: "GUILD_MEMBER",
      vacationMode: false,
    },
    orderBy: { id: "asc" },
    take: SELLER_PAGE_SIZE,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    select: {
      id: true,
      userId: true,
      guildLevel: true,
      listingsBelowThresholdSince: true,
      user: { select: { name: true, email: true } },
    },
  });
}

type GuildMemberSeller = Awaited<ReturnType<typeof fetchGuildMemberBatch>>[number];

async function checkGuildMemberSeller(
  seller: GuildMemberSeller,
  ninetyDaysAgo: Date,
  thirtyDaysAgo: Date
): Promise<number> {
  // Check 1: unresolved case older than 90 days
  const longCase = await prisma.case.findFirst({
    where: {
      sellerId: seller.userId,
      status: { in: ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE"] },
      createdAt: { lt: ninetyDaysAgo },
    },
    select: { id: true },
  });

  if (longCase) {
    await revokeMember(seller, "An unresolved dispute has been open for over 90 days.");
    return 1;
  }

  // Check 2: active listings below 5 for 30+ consecutive days
  if (
    seller.listingsBelowThresholdSince &&
    new Date(seller.listingsBelowThresholdSince) < thirtyDaysAgo
  ) {
    await revokeMember(
      seller,
      "Your shop has had fewer than 5 active listings for over 30 consecutive days."
    );
    return 1;
  }

  return 0;
}

async function revokeMember(
  seller: { id: string; userId: string; user: { name?: string | null; email?: string | null } | null },
  reason: string
) {
  await prisma.$transaction([
    prisma.sellerProfile.update({
      where: { id: seller.id },
      data: {
        guildLevel: "NONE",
        isVerifiedMaker: false,
        consecutiveMetricFailures: 0,
        metricWarningSentAt: null,
      },
    }),
    prisma.makerVerification.updateMany({
      where: { sellerProfileId: seller.id },
      data: { status: "REJECTED", reviewNotes: reason },
    }),
  ]);

  await createNotification({
    userId: seller.userId,
    type: "VERIFICATION_REJECTED",
    title: "Guild Member badge revoked",
    body: reason,
    link: "/dashboard/verification",
  });

  if (seller.user?.email) {
    try {
      await sendGuildMemberRevokedEmail({
        seller: { displayName: seller.user.name, email: seller.user.email },
        reason,
      });
    } catch (err) {
      Sentry.captureException(err, { tags: { source: "cron_guild_member_check_revoked_email", sellerId: seller.id } });
    }
  }
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

// src/app/api/cron/guild-member-check/route.ts
// Daily cron — runs every day at 8am UTC.
// Checks all Guild Members for revocation triggers:
//   1. Unresolved case older than 90 days
//   2. Active listing count below 5 for 30+ consecutive days

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { sendGuildMemberRevokedEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const sellers = await prisma.sellerProfile.findMany({
    where: { guildLevel: { in: ["GUILD_MEMBER", "GUILD_MASTER"] } },
    select: {
      id: true,
      userId: true,
      guildLevel: true,
      listingsBelowThresholdSince: true,
      user: { select: { name: true, email: true } },
    },
  });

  let revokedMember = 0;
  const errors: string[] = [];

  const BATCH = 10;
  for (let i = 0; i < sellers.length; i += BATCH) {
    const batch = sellers.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (seller) => {
        try {
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
            revokedMember++;
            return;
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
            revokedMember++;
          }
        } catch (err) {
          errors.push(`seller ${seller.id}: ${String(err)}`);
        }
      })
    );
  }

  return NextResponse.json({ revokedMember, errors });
}

async function revokeMember(
  seller: { id: string; userId: string; user: { name?: string | null; email?: string | null } | null },
  reason: string
) {
  await prisma.sellerProfile.update({
    where: { id: seller.id },
    data: {
      guildLevel: "NONE",
      isVerifiedMaker: false,
      consecutiveMetricFailures: 0,
      metricWarningSentAt: null,
    },
  });

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
    } catch { /* non-fatal */ }
  }
}

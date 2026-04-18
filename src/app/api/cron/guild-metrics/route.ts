// src/app/api/cron/guild-metrics/route.ts
// Monthly cron — runs 1st of every month at 9am UTC.
// Recalculates metrics for all Guild Members and Guild Masters;
// enforces 2-month grace period for Guild Master revocation.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  calculateSellerMetrics,
  meetsGuildMasterRequirements,
  GUILD_MASTER_REQUIREMENTS,
} from "@/lib/metrics";
import { createNotification } from "@/lib/notifications";
import {
  sendGuildMasterWarningEmail,
  sendGuildMasterRevokedEmail,
} from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 300; // 5-minute limit for large seller sets

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!cronSecret || bearer !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sellers = await prisma.sellerProfile.findMany({
    where: { guildLevel: { in: ["GUILD_MEMBER", "GUILD_MASTER"] } },
    select: {
      id: true,
      userId: true,
      guildLevel: true,
      consecutiveMetricFailures: true,
      user: { select: { name: true, email: true } },
    },
  });

  let processed = 0;
  let warned = 0;
  let revokedMaster = 0;
  const errors: string[] = [];

  // Process in batches of 10 to avoid DB overload
  const BATCH = 10;
  for (let i = 0; i < sellers.length; i += BATCH) {
    const batch = sellers.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (seller) => {
        try {
          const metrics = await calculateSellerMetrics(seller.id);
          const now = new Date();

          if (seller.guildLevel === "GUILD_MASTER") {
            const criteria = meetsGuildMasterRequirements(metrics);

            if (criteria.allMet) {
              // All good — reset failure tracking
              await prisma.sellerProfile.update({
                where: { id: seller.id },
                data: {
                  consecutiveMetricFailures: 0,
                  metricWarningSentAt: null,
                  lastMetricCheckAt: now,
                },
              });
            } else if (seller.consecutiveMetricFailures === 0) {
              // First failure — send warning
              const failedLabels = buildFailedLabels(criteria, metrics);

              await prisma.sellerProfile.update({
                where: { id: seller.id },
                data: {
                  consecutiveMetricFailures: 1,
                  metricWarningSentAt: now,
                  lastMetricCheckAt: now,
                },
              });

              await createNotification({
                userId: seller.userId,
                type: "VERIFICATION_REJECTED",
                title: "Guild Master status at risk",
                body: "Your metrics have fallen below Guild Master requirements. You have 30 days to improve before your badge is reviewed. Check your dashboard for details.",
                link: "/dashboard/verification",
              });

              if (seller.user?.email) {
                try {
                  await sendGuildMasterWarningEmail({
                    seller: { displayName: seller.user.name, email: seller.user.email },
                    failedCriteria: failedLabels,
                  });
                } catch { /* non-fatal */ }
              }

              warned++;
            } else {
              // Second consecutive failure — revoke Guild Master
              await prisma.sellerProfile.update({
                where: { id: seller.id },
                data: {
                  guildLevel: "GUILD_MEMBER",
                  consecutiveMetricFailures: 0,
                  metricWarningSentAt: null,
                  lastMetricCheckAt: now,
                },
              });

              await createNotification({
                userId: seller.userId,
                type: "VERIFICATION_REJECTED",
                title: "Guild Master badge revoked",
                body: "Your metrics fell below requirements for two consecutive months. Your Guild Member badge remains active.",
                link: "/dashboard/verification",
              });

              if (seller.user?.email) {
                try {
                  await sendGuildMasterRevokedEmail({
                    seller: { displayName: seller.user.name, email: seller.user.email },
                  });
                } catch { /* non-fatal */ }
              }

              revokedMaster++;
            }
          } else {
            // GUILD_MEMBER — just refresh metrics timestamp, no revocation logic here
            // (member revocation handled in daily guild-member-check cron)
            await prisma.sellerProfile.update({
              where: { id: seller.id },
              data: { lastMetricCheckAt: now },
            });
          }

          processed++;
        } catch (err) {
          errors.push(`seller ${seller.id}: ${String(err)}`);
        }
      })
    );
  }

  // Clean up view daily records older than 2 years
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  await prisma.listingViewDaily.deleteMany({ where: { date: { lt: twoYearsAgo } } }).catch(() => {});

  return NextResponse.json({ processed, warned, revokedMaster, errors });
}

function buildFailedLabels(
  criteria: ReturnType<typeof meetsGuildMasterRequirements>,
  metrics: Awaited<ReturnType<typeof calculateSellerMetrics>>
): string[] {
  const labels: string[] = [];
  if (!criteria.ratingMet)
    labels.push(
      `Average rating ${metrics.averageRating.toFixed(1)} (need ${GUILD_MASTER_REQUIREMENTS.averageRating}+)`
    );
  if (!criteria.reviewsMet)
    labels.push(
      `Review count ${metrics.reviewCount} (need ${GUILD_MASTER_REQUIREMENTS.reviewCount}+)`
    );
  if (!criteria.shippingMet)
    labels.push(
      `On-time shipping ${(metrics.onTimeShippingRate * 100).toFixed(0)}% (need ${GUILD_MASTER_REQUIREMENTS.onTimeShippingRate * 100}%+)`
    );
  if (!criteria.responseMet)
    labels.push(
      `Response rate ${(metrics.responseRate * 100).toFixed(0)}% (need ${GUILD_MASTER_REQUIREMENTS.responseRate * 100}%+)`
    );
  if (!criteria.ageMet)
    labels.push(
      `Account age ${metrics.accountAgeDays} days (need ${GUILD_MASTER_REQUIREMENTS.accountAgeDays}+ days)`
    );
  if (!criteria.salesMet)
    labels.push(
      `Completed sales $${(metrics.totalSalesCents / 100).toFixed(0)} (need $${GUILD_MASTER_REQUIREMENTS.totalSalesCents / 100}+)`
    );
  if (!criteria.casesMet)
    labels.push(`${metrics.activeCaseCount} open dispute${metrics.activeCaseCount !== 1 ? "s" : ""} (need 0)`);
  return labels;
}

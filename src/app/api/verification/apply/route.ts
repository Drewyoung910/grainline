// src/app/api/verification/apply/route.ts
import { NextResponse } from "next/server";
import { ensureSeller } from "@/lib/ensureSeller";
import { prisma } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";

const REQUIRED_LISTINGS = 5;
const REQUIRED_SALES_CENTS = 25000; // $250
const REQUIRED_ACCOUNT_DAYS = 30;

const VerificationApplySchema = z.object({
  craftDescription: z.string().min(1).max(500),
  yearsExperience: z.number().int().min(0).max(100),
  portfolioUrl: z.string().min(1).max(500).optional().nullable(),
});

export async function POST(req: Request) {
  try {
    const { seller } = await ensureSeller();

    let verParsed;
    try {
      verParsed = VerificationApplySchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const craftDescription = verParsed.craftDescription.trim().slice(0, 500);
    const yearsExperience = Math.max(0, Math.floor(verParsed.yearsExperience));
    const portfolioUrl = verParsed.portfolioUrl?.trim() || null;

    // ── Server-side eligibility check ─────────────────────────────────────
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const sellerData = await prisma.sellerProfile.findUnique({
      where: { id: seller.id },
      select: { userId: true, user: { select: { createdAt: true } } },
    });

    if (!sellerData) {
      return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });
    }

    const [activeListings, salesResult, longCaseCount] = await Promise.all([
      prisma.listing.count({ where: { sellerId: seller.id, status: "ACTIVE" } }),
      prisma.orderItem.aggregate({
        where: {
          listing: { sellerId: seller.id },
          order: { fulfillmentStatus: { in: ["DELIVERED", "PICKED_UP"] } },
        },
        _sum: { priceCents: true },
      }),
      prisma.case.count({
        where: {
          sellerId: sellerData.userId,
          status: { notIn: ["RESOLVED", "CLOSED"] },
          createdAt: { lt: sixtyDaysAgo },
        },
      }),
    ]);

    const totalSalesCents = salesResult._sum.priceCents ?? 0;
    const accountAgeDays = sellerData.user?.createdAt
      ? Math.floor((Date.now() - new Date(sellerData.user.createdAt).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    if (activeListings < REQUIRED_LISTINGS) {
      return NextResponse.json(
        { error: `You need at least ${REQUIRED_LISTINGS} active listings. You currently have ${activeListings}.` },
        { status: 400 }
      );
    }
    if (totalSalesCents < REQUIRED_SALES_CENTS) {
      const needed = ((REQUIRED_SALES_CENTS - totalSalesCents) / 100).toFixed(2);
      return NextResponse.json(
        { error: `You need $250 in completed sales. You need $${needed} more.` },
        { status: 400 }
      );
    }
    if (accountAgeDays < REQUIRED_ACCOUNT_DAYS) {
      const remaining = REQUIRED_ACCOUNT_DAYS - accountAgeDays;
      return NextResponse.json(
        { error: `Your account must be at least ${REQUIRED_ACCOUNT_DAYS} days old. ${remaining} days remaining.` },
        { status: 400 }
      );
    }
    if (longCaseCount > 0) {
      return NextResponse.json(
        { error: `You have ${longCaseCount} unresolved case${longCaseCount !== 1 ? "s" : ""} open longer than 60 days. Resolve them before applying.` },
        { status: 400 }
      );
    }

    const record = await prisma.makerVerification.upsert({
      where: { sellerProfileId: seller.id },
      create: {
        sellerProfileId: seller.id,
        craftDescription,
        yearsExperience,
        portfolioUrl,
        status: "PENDING",
      },
      update: {
        craftDescription,
        yearsExperience,
        portfolioUrl,
        status: "PENDING",
        reviewedById: null,
        reviewNotes: null,
        reviewedAt: null,
        appliedAt: new Date(),
      },
    });

    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    console.error("POST /api/verification/apply error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

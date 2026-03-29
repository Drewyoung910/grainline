// src/app/api/verification/apply/route.ts
import { NextResponse } from "next/server";
import { ensureSeller } from "@/lib/ensureSeller";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { seller } = await ensureSeller();

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty */ }

    const craftDescription = typeof body.craftDescription === "string" ? body.craftDescription.trim().slice(0, 500) : "";
    const yearsExperience = typeof body.yearsExperience === "number" ? Math.max(0, Math.floor(body.yearsExperience)) : null;
    const portfolioUrl = typeof body.portfolioUrl === "string" ? body.portfolioUrl.trim() || null : null;

    if (!craftDescription) {
      return NextResponse.json({ error: "craftDescription is required" }, { status: 400 });
    }
    if (yearsExperience === null || !Number.isFinite(yearsExperience)) {
      return NextResponse.json({ error: "yearsExperience must be a non-negative integer" }, { status: 400 });
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

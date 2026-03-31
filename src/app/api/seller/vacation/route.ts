import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const { seller } = await ensureSeller();

    const body = await req.json();
    const vacationMode = Boolean(body.vacationMode);
    const vacationReturnDate = body.vacationReturnDate ? new Date(body.vacationReturnDate) : null;
    const vacationMessage =
      typeof body.vacationMessage === "string" && body.vacationMessage.trim()
        ? body.vacationMessage.trim().slice(0, 200)
        : null;

    await prisma.sellerProfile.update({
      where: { id: seller.id },
      data: { vacationMode, vacationReturnDate, vacationMessage },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/seller/vacation error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

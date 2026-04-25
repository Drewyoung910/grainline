import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { z } from "zod";
import { rateLimitResponse, safeRateLimit, vacationRatelimit } from "@/lib/ratelimit";

const VacationSchema = z.object({
  vacationMode: z.boolean(),
  vacationReturnDate: z.string().datetime().optional().nullable(),
  vacationMessage: z.string().max(200).optional().nullable(),
});

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const { success, reset } = await safeRateLimit(vacationRatelimit, userId);
    if (!success) return rateLimitResponse(reset, "Too many vacation mode updates.");

    const { seller } = await ensureSeller();

    let vacParsed;
    try {
      vacParsed = VacationSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const vacationMode = vacParsed.vacationMode;
    const vacationReturnDate = vacParsed.vacationReturnDate ? new Date(vacParsed.vacationReturnDate) : null;
    const vacationMessage = vacParsed.vacationMessage?.trim() || null;

    await prisma.sellerProfile.update({
      where: { id: seller.id },
      data: { vacationMode, vacationReturnDate, vacationMessage },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    console.error("POST /api/seller/vacation error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

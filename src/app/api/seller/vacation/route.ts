import { after, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { z } from "zod";
import { rateLimitResponse, safeRateLimit, vacationRatelimit } from "@/lib/ratelimit";
import { expireOpenCheckoutSessionsForSeller } from "@/lib/checkoutSessionExpiry";
import { revalidatePublicSellerVisibilityCaches } from "@/lib/searchCache";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { sanitizeText, truncateText } from "@/lib/sanitize";

const VacationSchema = z.object({
  vacationMode: z.boolean(),
  vacationReturnDate: z.string().max(40).optional().nullable(),
  vacationMessage: z.string().max(200).optional().nullable(),
});

export const runtime = "nodejs";
const SELLER_VACATION_BODY_MAX_BYTES = 16 * 1024;
const VACATION_RETURN_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseVacationReturnDate(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = VACATION_RETURN_DATE_RE.exec(trimmed);
  if (!match) return null;

  const [, yearRaw, monthRaw, dayRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function isPastVacationReturnDate(date: Date, now = new Date()) {
  const todayNoonUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0, 0),
  );
  // Native date inputs carry no timezone; allow one UTC day of cushion for local "today".
  const earliestAllowedNoonUtc = new Date(todayNoonUtc.getTime() - 24 * 60 * 60 * 1000);
  return date.getTime() < earliestAllowedNoonUtc.getTime();
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const { success, reset } = await safeRateLimit(vacationRatelimit, userId);
    if (!success) return rateLimitResponse(reset, "Too many vacation mode updates.");

    const { seller } = await ensureSeller();

    let vacParsed;
    try {
      vacParsed = VacationSchema.parse(await readBoundedJson(req, SELLER_VACATION_BODY_MAX_BYTES));
    } catch (e) {
      if (isRequestBodyTooLargeError(e)) {
        return NextResponse.json({ error: "Request body too large" }, { status: 413 });
      }
      if (isInvalidJsonBodyError(e)) {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      }
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      throw e;
    }
    const vacationMode = vacParsed.vacationMode;
    const vacationReturnDate = parseVacationReturnDate(vacParsed.vacationReturnDate);
    if (vacParsed.vacationReturnDate && !vacationReturnDate) {
      return NextResponse.json({ error: "Invalid return date" }, { status: 400 });
    }
    if (vacationMode && vacationReturnDate && isPastVacationReturnDate(vacationReturnDate)) {
      return NextResponse.json({ error: "Return date cannot be in the past" }, { status: 400 });
    }
    const vacationMessage = vacParsed.vacationMessage
      ? truncateText(sanitizeText(vacParsed.vacationMessage), 200) || null
      : null;

    await prisma.sellerProfile.update({
      where: { id: seller.id },
      data: { vacationMode, vacationReturnDate, vacationMessage },
    });
    revalidatePublicSellerVisibilityCaches();

    if (vacationMode) {
      after(() =>
        expireOpenCheckoutSessionsForSeller({
          sellerId: seller.id,
          stripeAccountId: seller.stripeAccountId,
          source: "seller_vacation",
        }),
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    console.error("POST /api/seller/vacation error:", err);
    Sentry.captureException(err, {
      level: "warning",
      tags: { source: "seller_vacation_update" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

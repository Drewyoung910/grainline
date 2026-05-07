import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUser } from "@/lib/ensureUser";
import { prisma } from "@/lib/db";
import { safeRateLimit, termsAcceptanceRatelimit, rateLimitResponse } from "@/lib/ratelimit";
import { CURRENT_TERMS_VERSION, currentTermsAcceptanceUpdate } from "@/lib/termsAcceptance";

const AcceptTermsSchema = z.object({
  termsAccepted: z.literal(true),
  ageAttested: z.literal(true),
  termsVersion: z.literal(CURRENT_TERMS_VERSION),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(termsAcceptanceRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many acceptance attempts.");

  const parsed = AcceptTermsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Terms acceptance and age confirmation are required.", code: "TERMS_ACCEPTANCE_REQUIRED" },
      { status: 400 },
    );
  }

  let me: Awaited<ReturnType<typeof ensureUser>>;
  try {
    me = await ensureUser();
  } catch (error) {
    const accountResponse = accountAccessErrorResponse(error);
    if (accountResponse) return accountResponse;
    throw error;
  }

  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const acceptedAt = new Date();
  const user = await prisma.user.update({
    where: { id: me.id },
    data: currentTermsAcceptanceUpdate(me, acceptedAt),
    select: {
      termsAcceptedAt: true,
      termsVersion: true,
      ageAttestedAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
    termsVersion: user.termsVersion,
    ageAttestedAt: user.ageAttestedAt?.toISOString() ?? null,
  });
}

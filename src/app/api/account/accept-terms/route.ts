import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUser } from "@/lib/ensureUser";
import { prisma } from "@/lib/db";
import { safeRateLimit, termsAcceptanceRatelimit, rateLimitResponse } from "@/lib/ratelimit";
import { CURRENT_TERMS_VERSION, currentTermsAcceptanceUpdate } from "@/lib/termsAcceptance";
import { isRequestBodyTooLargeError, readOptionalBoundedJson } from "@/lib/requestBody";
import { invalidateAccountStateCache } from "@/lib/accountStateCache";

const AcceptTermsSchema = z.object({
  termsAccepted: z.literal(true),
  ageAttested: z.literal(true),
  termsVersion: z.literal(CURRENT_TERMS_VERSION),
});
const ACCEPT_TERMS_BODY_MAX_BYTES = 8 * 1024;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(termsAcceptanceRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many acceptance attempts.");

  let body: unknown;
  try {
    body = await readOptionalBoundedJson(req, ACCEPT_TERMS_BODY_MAX_BYTES, null);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    throw error;
  }
  const parsed = AcceptTermsSchema.safeParse(body);
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
  await invalidateAccountStateCache(userId, "accept_terms_account_state_cache_invalidate");

  return NextResponse.json({
    ok: true,
    termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
    termsVersion: user.termsVersion,
    ageAttestedAt: user.ageAttestedAt?.toISOString() ?? null,
  });
}

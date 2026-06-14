import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUser } from "@/lib/ensureUser";
import { prisma } from "@/lib/db";
import { safeRateLimit, termsAcceptanceRatelimit, rateLimitResponse } from "@/lib/ratelimit";
import { CURRENT_TERMS_VERSION, currentTermsAcceptanceUpdate } from "@/lib/termsAcceptance";
import { isRequestBodyTooLargeError, readOptionalBoundedJson } from "@/lib/requestBody";
import { invalidateAccountStateCache } from "@/lib/accountStateCache";
import { logUserAuditAction } from "@/lib/audit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";

const AcceptTermsSchema = z.object({
  termsAccepted: z.literal(true),
  ageAttested: z.literal(true),
  termsVersion: z.literal(CURRENT_TERMS_VERSION),
});
const ACCEPT_TERMS_BODY_MAX_BYTES = 8 * 1024;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  const { success, reset } = await safeRateLimit(termsAcceptanceRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many acceptance attempts."));

  let body: unknown;
  try {
    body = await readOptionalBoundedJson(req, ACCEPT_TERMS_BODY_MAX_BYTES, null);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
    }
    throw error;
  }
  const parsed = AcceptTermsSchema.safeParse(body);
  if (!parsed.success) {
    return privateJson(
      { error: "Terms acceptance and age confirmation are required.", code: "TERMS_ACCEPTANCE_REQUIRED" },
      { status: HTTP_STATUS.BAD_REQUEST },
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

  if (!me) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

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
  await logUserAuditAction({
    actorId: me.id,
    action: "TERMS_ACCEPTED",
    targetType: "USER",
    targetId: me.id,
    metadata: {
      termsVersion: user.termsVersion,
      termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? acceptedAt.toISOString(),
      ageAttestedAt: user.ageAttestedAt?.toISOString() ?? null,
      route: "/api/account/accept-terms",
    },
  });

  return privateJson({
    ok: true,
    termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
    termsVersion: user.termsVersion,
    ageAttestedAt: user.ageAttestedAt?.toISOString() ?? null,
  });
}

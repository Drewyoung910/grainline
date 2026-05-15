import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { markReadRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { isRequestBodyTooLargeError, readOptionalBoundedJson } from "@/lib/requestBody";

export const runtime = "nodejs";
const NOTIFICATION_READ_ALL_BODY_MAX_BYTES = 16 * 1024;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(markReadRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many notification updates.");

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    if (isAccountAccessError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await readOptionalBoundedJson(req, NOTIFICATION_READ_ALL_BODY_MAX_BYTES, {});
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    throw error;
  }
  const bodyObject = body as { ids?: unknown };
  const ids = Array.isArray(bodyObject.ids)
    ? bodyObject.ids.filter((id: unknown): id is string => typeof id === "string").slice(0, 100)
    : [];

  await prisma.notification.updateMany({
    where: {
      userId: me.id,
      read: false,
      ...(ids.length > 0 ? { id: { in: ids } } : {}),
    },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}

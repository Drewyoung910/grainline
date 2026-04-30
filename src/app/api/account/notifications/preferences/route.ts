// POST { type: string, enabled: boolean }
// Auth required
// Updates user.notificationPreferences JSON field
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { VALID_PREFERENCE_KEYS } from "@/lib/notificationPreferenceKeys";
import { z } from "zod";

const PreferencesSchema = z.object({
  type: z.enum(VALID_PREFERENCE_KEYS),
  enabled: z.boolean(),
});

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  let body;
  try {
    body = PreferencesSchema.parse(await request.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { type, enabled } = body;

  await prisma.$executeRaw`
    UPDATE "User"
    SET "notificationPreferences" = jsonb_set(
      COALESCE("notificationPreferences", '{}'::jsonb),
      ARRAY[${type}]::text[],
      to_jsonb(${enabled}::boolean),
      true
    )
    WHERE "id" = ${me.id}
  `;

  return NextResponse.json({ ok: true });
}

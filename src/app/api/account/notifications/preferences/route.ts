// POST { type: string, enabled: boolean }
// Auth required
// Updates user.notificationPreferences JSON field
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const PreferencesSchema = z.object({
  type: z.enum([
    "NEW_MESSAGE", "NEW_ORDER", "ORDER_SHIPPED", "ORDER_DELIVERED",
    "CASE_OPENED", "CASE_MESSAGE", "CASE_RESOLVED",
    "CUSTOM_ORDER_REQUEST", "CUSTOM_ORDER_LINK",
    "VERIFICATION_APPROVED", "VERIFICATION_REJECTED",
    "BACK_IN_STOCK", "NEW_REVIEW", "LOW_STOCK", "NEW_FAVORITE",
    "NEW_BLOG_COMMENT", "BLOG_COMMENT_REPLY",
    "NEW_FOLLOWER", "FOLLOWED_MAKER_NEW_LISTING", "FOLLOWED_MAKER_NEW_BLOG",
    "SELLER_BROADCAST", "COMMISSION_INTEREST",
    "LISTING_APPROVED", "LISTING_REJECTED",
    "EMAIL_NEW_MESSAGE", "EMAIL_NEW_ORDER", "EMAIL_CUSTOM_ORDER",
    "EMAIL_CASE_OPENED", "EMAIL_CASE_MESSAGE", "EMAIL_CASE_RESOLVED",
    "EMAIL_NEW_REVIEW", "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
    "EMAIL_SELLER_BROADCAST", "EMAIL_NEW_FOLLOWER",
  ]),
  enabled: z.boolean(),
});

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, notificationPreferences: true },
  });
  if (!me) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const prefs = (me.notificationPreferences as Record<string, boolean>) ?? {};
  prefs[type] = enabled;

  await prisma.user.update({
    where: { id: me.id },
    data: { notificationPreferences: prefs },
  });

  return NextResponse.json({ ok: true });
}

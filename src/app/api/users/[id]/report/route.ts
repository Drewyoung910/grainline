import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureUser } from "@/lib/ensureUser";
import { z } from "zod";
import { reportRatelimit, safeRateLimit } from "@/lib/ratelimit";

const Schema = z.object({
  reason: z.enum(["SPAM", "HARASSMENT", "FAKE_LISTING", "INAPPROPRIATE", "OTHER"]),
  details: z.string().max(500).optional(),
  targetType: z.string().max(50).optional(),
  targetId: z.string().max(100).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await ensureUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await safeRateLimit(reportRatelimit, me.id);
  if (!rl.success) return NextResponse.json({ error: "Too many reports" }, { status: 429 });

  const { id: reportedId } = await params;
  if (reportedId === me.id) return NextResponse.json({ error: "Cannot report yourself" }, { status: 400 });

  let body;
  try {
    body = Schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  await prisma.userReport.create({
    data: { reporterId: me.id, reportedId, reason: body.reason, details: body.details, targetType: body.targetType ?? null, targetId: body.targetId ?? null },
  });

  return NextResponse.json({ ok: true });
}

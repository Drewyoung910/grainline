// src/app/api/me/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ role: null });

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true },
  });

  return Response.json({ role: user?.role ?? null });
}

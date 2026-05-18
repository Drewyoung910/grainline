"use server";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { blockRatelimit, safeRateLimit } from "@/lib/ratelimit";

export async function unblockUser(blockedId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const { success } = await safeRateLimit(blockRatelimit, userId);
  if (!success) return;

  const me = await ensureUserByClerkId(userId);

  await prisma.block.deleteMany({
    where: { blockerId: me.id, blockedId },
  });

  revalidatePath("/account/blocked");
}

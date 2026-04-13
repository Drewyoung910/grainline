"use server";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function unblockUser(blockedId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) throw new Error("Unauthorized");

  await prisma.block.deleteMany({
    where: { blockerId: me.id, blockedId },
  });

  revalidatePath("/account/blocked");
}

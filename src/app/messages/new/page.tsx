// src/app/messages/new/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

export default async function NewConversationPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string; listing?: string }>;
}) {
  const { to, listing } = await searchParams;

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/messages/new");

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) redirect("/sign-in?redirect_url=/messages/new");

  if (!to) redirect("/messages");

  const other = await prisma.user.findUnique({ where: { id: to } });
  if (!other || other.id === me.id) redirect("/messages");

  // Canonicalize participant order
  const [a, b] = [me.id, other.id].sort((x, y) => (x < y ? -1 : 1));
  const contextListingId = listing ?? null;

  // Prefer upsert to avoid race + preserve existing context
  // (We won't overwrite contextListingId if the convo already exists.)
  let convo = await prisma.conversation.findUnique({
    where: { userAId_userBId: { userAId: a, userBId: b } },
  });

  if (!convo) {
    try {
      convo = await prisma.conversation.create({
        data: { userAId: a, userBId: b, contextListingId: contextListingId ?? undefined },
      });
    } catch (e) {
      // Handle race: someone created it between our find & create
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        convo = await prisma.conversation.findUnique({
          where: { userAId_userBId: { userAId: a, userBId: b } },
        });
      } else {
        throw e;
      }
    }
  }

  if (!convo) redirect("/messages"); // safety

  // If convo exists but has no context, gently attach it (don’t overwrite)
  if (contextListingId && !convo.contextListingId) {
    await prisma.conversation.update({
      where: { id: convo.id },
      data: { contextListingId },
    });
  }

  redirect(`/messages/${convo.id}`);
}



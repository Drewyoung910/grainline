import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import { prisma } from "@/lib/db";
import {
  canAttachConversationContextListing,
  canStartConversationWith,
} from "@/lib/conversationStartState";
import { startConversationForUser } from "@/lib/conversationStartAccess";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NewConversationPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string; listing?: string }>;
}) {
  const { to, listing } = await searchParams;
  const requestedPath = `/messages/new${to ? `?to=${encodeURIComponent(to)}` : ""}${
    listing ? `${to ? "&" : "?"}listing=${encodeURIComponent(listing)}` : ""
  }`;

  const { userId } = await auth();
  if (!userId) redirect(`/sign-in?redirect_url=${encodeURIComponent(requestedPath)}`);

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me || me.banned || me.deletedAt || !to) redirect("/messages");
  const targetUserId = to;

  const other = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, banned: true, deletedAt: true },
  });
  if (!other) redirect("/messages");

  const blockExists = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: me.id, blockedId: other.id },
        { blockerId: other.id, blockedId: me.id },
      ],
    },
    select: { id: true },
  });
  if (!canStartConversationWith(me.id, other, !!blockExists)) redirect("/messages");

  let validListingId: string | null = null;
  let listingTitle: string | null = null;
  if (listing) {
    const contextListing = await prisma.listing.findUnique({
      where: { id: listing },
      select: {
        id: true,
        title: true,
        status: true,
        isPrivate: true,
        reservedForUserId: true,
        seller: {
          select: {
            chargesEnabled: true,
            stripeAccountVersion: true,
            vacationMode: true,
            user: { select: { id: true, banned: true, deletedAt: true } },
          },
        },
      },
    });
    if (contextListing && canAttachConversationContextListing(contextListing, [me.id, other.id])) {
      validListingId = contextListing.id;
      listingTitle = contextListing.title;
    }
  }

  const [userAId, userBId] = [me.id, other.id].sort((left, right) => (
    left < right ? -1 : 1
  ));
  const existing = await prisma.conversation.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
    select: { id: true },
  });
  const listingQuery = validListingId
    ? `?listing=${encodeURIComponent(validListingId)}`
    : "";
  if (existing) redirect(`/messages/${existing.id}${listingQuery}`);

  async function startConversation(): Promise<{ ok: boolean; error?: string }> {
    "use server";

    const { userId } = await auth();
    if (!userId) return { ok: false, error: "Sign in to start a conversation." };
    const currentUser = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, banned: true, deletedAt: true },
    });
    if (!currentUser || currentUser.banned || currentUser.deletedAt) {
      return { ok: false, error: "Your account is not available." };
    }

    const { safeRateLimit, conversationStartRatelimit } = await import("@/lib/ratelimit");
    const rate = await safeRateLimit(conversationStartRatelimit, currentUser.id);
    if (!rate.success) {
      return { ok: false, error: "You're starting conversations too quickly. Please try again later." };
    }

    const result = await startConversationForUser(
      currentUser.id,
      targetUserId,
      validListingId,
    );
    if (!result.ok) {
      return { ok: false, error: "This conversation is no longer available." };
    }
    redirect(`/messages/${result.conversationId}${listingQuery}`);
  }

  return (
    <main className="min-h-[100svh] bg-[#F7F5F0] px-4 py-10">
      <section className="card-section mx-auto max-w-lg bg-white p-6 sm:p-8">
        <h1 className="font-display text-2xl text-neutral-900">Start a conversation</h1>
        <p className="mt-3 text-sm text-neutral-600">
          Message {other.name || "this Grainline member"}
          {listingTitle ? ` about ${listingTitle}` : ""}.
        </p>
        <p className="mt-2 text-sm text-neutral-500">
          The private thread is created only when you continue—not when this page is previewed or prefetched.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ActionForm action={startConversation}>
            <SubmitButton
              pendingLabel="Starting…"
              className="min-h-[44px] rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
            >
              Continue to message
            </SubmitButton>
          </ActionForm>
          <Link
            href="/messages"
            className="inline-flex min-h-[44px] items-center rounded-md border border-neutral-200 bg-white px-5 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            Cancel
          </Link>
        </div>
      </section>
    </main>
  );
}

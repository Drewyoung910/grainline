// src/app/messages/[id]/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import MarkReadClient from "@/components/MarkReadClient";
import ThreadMessages from "@/components/ThreadMessages";
import MessageComposer from "@/components/MessageComposer";
import Link from "next/link";
import ThreadCustomOrderButton from "@/components/ThreadCustomOrderButton";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { userId } = await auth();
  if (!userId) redirect(`/sign-in?redirect_url=/messages/${id}`);

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) redirect(`/sign-in?redirect_url=/messages/${id}`);

  const convo = await prisma.conversation.findFirst({
    where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
    include: {
      userA: { select: { id: true, name: true, email: true, imageUrl: true } },
      userB: { select: { id: true, name: true, email: true, imageUrl: true } },
      contextListing: {
        select: {
          id: true,
          title: true,
          priceCents: true,
          currency: true,
          photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        },
      },
    },
  });
  if (!convo) return notFound();

  // Auto-mark any unread NEW_MESSAGE notifications for this conversation as read
  await prisma.notification.updateMany({
    where: {
      userId: me.id,
      type: "NEW_MESSAGE",
      read: false,
      link: { contains: `/messages/${id}` },
    },
    data: { read: true },
  });

  const other = convo.userAId === me.id ? convo.userB : convo.userA;

  // Check if the other participant is a seller accepting custom orders
  const otherSellerProfile = other
    ? await prisma.sellerProfile.findUnique({
        where: { userId: other.id },
        select: { displayName: true, acceptsCustomOrders: true },
      })
    : null;
  const showCustomOrderButton = !!(otherSellerProfile?.acceptsCustomOrders);

  const messages = await prisma.message.findMany({
    where: { conversationId: convo.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      senderId: true,
      recipientId: true,
      body: true,
      kind: true,
      createdAt: true,
      readAt: true,
    },
  });

  // --- Server actions --------------------------------------------------------
  async function sendMessage(_prev: unknown, formData: FormData) {
    "use server";

    const { userId } = await auth();
    if (!userId) return { ok: false };

    const me = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!me) return { ok: false };

    const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
    const raw = String(formData.get("attachments") ?? "[]");
    let atts: Array<{ url: string; name?: string; type?: string }> = [];
    try {
      atts = JSON.parse(raw);
      if (!Array.isArray(atts)) atts = [];
    } catch {}

    // Validate participation
    const c = await prisma.conversation.findFirst({
      where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
      select: { id: true, userAId: true, userBId: true },
    });
    if (!c) return { ok: false };

    const recipientId = c.userAId === me.id ? c.userBId : c.userAId;

    // 1) attachments -> each as its own message (JSON payload in body)
    for (const a of atts) {
      if (!a?.url) continue;
      const payload = JSON.stringify({
        kind: "file",
        url: a.url,
        name: a.name ?? null,
        type: a.type ?? null,
      });
      await prisma.message.create({
        data: { conversationId: id, senderId: me.id, recipientId, body: payload },
      });
    }

    // 2) text message if present
    if (body) {
      await prisma.message.create({
        data: { conversationId: id, senderId: me.id, recipientId, body },
      });
    }

    // bump thread
    await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    // Notify recipient
    if (atts.length > 0 || body) {
      await createNotification({
        userId: recipientId,
        type: "NEW_MESSAGE",
        title: `${me.name ?? me.email?.split("@")[0] ?? "Someone"} sent you a message`,
        body: body || "Sent an attachment",
        link: `/messages/${id}`,
      });
    }

    return { ok: true };
  }

  async function archiveThread(_prev: unknown, _formData: FormData): Promise<{ ok: boolean }> {
    "use server";
    const { userId } = await auth();
    if (!userId) redirect(`/sign-in?redirect_url=/messages/${id}`);
    const me = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!me) redirect(`/sign-in?redirect_url=/messages/${id}`);

    const c = await prisma.conversation.findFirst({
      where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
      select: { id: true, userAId: true, userBId: true },
    });
    if (!c) return { ok: false };

    await prisma.conversation.update({
      where: { id },
      data:
        c.userAId === me.id
          ? { archivedAAt: new Date() }
          : { archivedBAt: new Date() },
    });

    redirect("/messages?tab=archived");
  }

  async function unarchiveThread(_prev: unknown, _formData: FormData): Promise<{ ok: boolean }> {
    "use server";
    const { userId } = await auth();
    if (!userId) redirect(`/sign-in?redirect_url=/messages/${id}`);
    const me = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!me) redirect(`/sign-in?redirect_url=/messages/${id}`);

    const c = await prisma.conversation.findFirst({
      where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
      select: { id: true, userAId: true, userBId: true },
    });
    if (!c) return { ok: false };

    await prisma.conversation.update({
      where: { id },
      data:
        c.userAId === me.id
          ? { archivedAAt: null }
          : { archivedBAt: null },
    });

    redirect("/messages");
  }
  // ---------------------------------------------------------------------------

  const ctx = convo.contextListing;
  const ctxImg = ctx?.photos?.[0]?.url ?? null;
  const archivedForMe =
    (convo.userAId === me.id ? convo.archivedAAt : convo.archivedBAt) ?? null;

  return (
    <main className="max-w-3xl mx-auto p-4 sm:p-8 space-y-4 sm:space-y-6">
      <MarkReadClient id={id} />

      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-neutral-200 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {other?.imageUrl ? <img src={other.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
          </div>
          <div className="font-medium">{other?.name || other?.email || "User"}</div>
          {archivedForMe ? (
            <span className="ml-2 rounded-full border px-2 py-[2px] text-[11px] text-neutral-600">Archived</span>
          ) : null}
          {showCustomOrderButton && other && (
            <ThreadCustomOrderButton
              sellerUserId={other.id}
              sellerName={otherSellerProfile?.displayName ?? other.name ?? other.email ?? "Maker"}
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Archive / Unarchive */}
          <ActionForm action={archivedForMe ? unarchiveThread : archiveThread}>
            <SubmitButton className="rounded-full border px-3 py-1 text-sm hover:bg-neutral-50">
              {archivedForMe ? "Unarchive" : "Archive"}
            </SubmitButton>
          </ActionForm>

          <Link href="/messages" className="text-sm underline">
            Back to inbox
          </Link>
        </div>
      </header>

      {ctx && (
        <Link
          href={`/listing/${ctx.id}`}
          className="flex items-center gap-3 rounded-xl border bg-white p-3 hover:bg-neutral-50"
        >
          <div className="h-14 w-14 rounded-lg overflow-hidden bg-neutral-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {ctxImg ? <img src={ctxImg} alt="" className="h-full w-full object-cover" /> : null}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{ctx.title}</div>
            <div className="text-sm text-neutral-600">
              {(ctx.priceCents / 100).toLocaleString(undefined, {
                style: "currency",
                currency: ctx.currency ?? "USD",
              })}
            </div>
          </div>
          <div className="ml-auto text-sm text-neutral-500">View listing →</div>
        </Link>
      )}

      {/* scrollable thread */}
      <ThreadMessages convoId={convo.id} meId={me.id} initial={messages} />

      {/* sticky composer */}
      <ActionForm action={sendMessage}>
        <MessageComposer />
      </ActionForm>
    </main>
  );
}







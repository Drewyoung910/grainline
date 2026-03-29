import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return new Response("unauthorized", { status: 401 });

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) return new Response("unauthorized", { status: 401 });

  const allowed = await prisma.conversation.findFirst({
    where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
    select: { id: true },
  });
  if (!allowed) return new Response("forbidden", { status: 403 });

  const url = new URL(req.url);
  let since = Number(url.searchParams.get("since") || 0);
  if (Number.isNaN(since)) since = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      const ping = () => controller.enqueue(encoder.encode(`: ping\n\n`));

      let closed = false;
      const interval = setInterval(async () => {
        if (closed) return;
        try {
          const messages = await prisma.message.findMany({
            where: {
              conversationId: id,
              ...(since ? { createdAt: { gt: new Date(since) } } : {}),
            },
            orderBy: { createdAt: "asc" },
            select: { id: true, senderId: true, recipientId: true, body: true, kind: true, createdAt: true, readAt: true },
          });
          if (messages.length) {
            since = new Date(messages[messages.length - 1].createdAt).getTime();
            send({ type: "messages", messages });
          } else {
            // keep-alive comment so proxies don’t close us
            ping();
          }
        } catch {
          // swallow and keep connection alive
          ping();
        }
      }, 1000);

      // close handler
      req.signal?.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

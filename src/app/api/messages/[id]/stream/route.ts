import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { messageStreamRatelimit, safeRateLimit } from "@/lib/ratelimit";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await safeRateLimit(messageStreamRatelimit, userId);
  if (!success) return Response.json({ error: "Too many requests" }, { status: 429 });

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    if (isAccountAccessError(err)) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  const allowed = await prisma.conversation.findFirst({
    where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
    select: { id: true },
  });
  if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });

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
      let pollDelayMs = 3000;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let reportedPollError = false;

      const poll = async () => {
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
            pollDelayMs = 3000;
          } else {
            // keep-alive comment so proxies don’t close us
            ping();
            pollDelayMs = Math.min(pollDelayMs + 1000, 10000);
          }
        } catch (err) {
          if (!reportedPollError) {
            reportedPollError = true;
            Sentry.captureException(err, {
              tags: { source: "message_stream_poll" },
              extra: { conversationId: id },
            });
          }
          ping();
          pollDelayMs = Math.min(pollDelayMs * 2, 15000);
        }
        if (!closed) timeout = setTimeout(poll, pollDelayMs);
      };

      timeout = setTimeout(poll, 0);

      // close handler
      req.signal?.addEventListener("abort", () => {
        closed = true;
        if (timeout) clearTimeout(timeout);
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

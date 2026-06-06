import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { messageStreamRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { parseTimestampMsParam } from "@/lib/queryParams";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(messageStreamRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many message update requests."));

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    if (isAccountAccessError(err)) {
      return privateJson({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  const allowed = await prisma.conversation.findFirst({
    where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
    select: { id: true },
  });
  if (!allowed) return privateJson({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  let since = parseTimestampMsParam(url.searchParams.get("since")) ?? 0;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      let closed = false;
      let pollDelayMs = 3000;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let reportedPollError = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          closed = true;
          if (timeout) clearTimeout(timeout);
          return false;
        }
      };
      const send = (data: unknown) => safeEnqueue(`data: ${JSON.stringify(data)}\n\n`);
      const ping = () => safeEnqueue(`: ping\n\n`);
      const closeStream = () => {
        if (closed) return;
        closed = true;
        if (timeout) clearTimeout(timeout);
        try {
          controller.close();
        } catch {
          // The client may already have closed the stream; cleanup is enough.
        }
      };

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
            if (!send({ type: "messages", messages })) return;
            pollDelayMs = 3000;
          } else {
            // keep-alive comment so proxies don’t close us
            if (!ping()) return;
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
          if (!ping()) return;
          pollDelayMs = Math.min(pollDelayMs * 2, 15000);
        }
        if (!closed) timeout = setTimeout(poll, pollDelayMs);
      };

      timeout = setTimeout(poll, 0);

      // close handler
      req.signal?.addEventListener("abort", closeStream, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store, no-cache, no-transform, max-age=0",
      Vary: "Cookie",
      Connection: "keep-alive",
    },
  });
}

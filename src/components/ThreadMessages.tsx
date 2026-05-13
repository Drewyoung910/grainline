"use client";

import * as React from "react";
import Link from "next/link";
import { MessageCircle, Palette, Logs } from "@/components/icons";
import {
  parseCommissionInterestMessageBody,
  parseCustomOrderLinkMessageBody,
  parseCustomOrderRequestMessageBody,
  parseFileMessageBody,
  parseThreadMessagesEvent,
} from "@/lib/messageBodies";
import { isTerminalMessageStreamStatus, messageStreamStatusMessage } from "@/lib/messageStreamState";
import { publicListingPath } from "@/lib/publicPaths";

type Msg = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  kind?: string | null;
  isSystemMessage?: boolean | null;
  createdAt: string | Date;
  readAt?: string | Date | null;
};

type OtherUser = {
  imageUrl?: string | null;
  avatarImageUrl?: string | null;
  name?: string | null;
};

const isImageUrl = (s: string) =>
  /^https?:\/\/.+\.(png|jpe?g|gif|webp|avif)$/i.test(s.trim());
const isPdfUrl = (s: string) => /^https?:\/\/.+\.pdf$/i.test(s.trim());

function PdfChip({ url, name }: { url: string; name?: string | null }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
    >
      {/* tiny PDF icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="#ef4444" /* red-500 */
        aria-hidden="true"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
        <path d="M14 2v6h6" fill="#fff" opacity="0.6" />
      </svg>
      <span className="truncate max-w-[220px]">{name ?? "Document.pdf"}</span>
      <span className="text-xs text-neutral-500">Open</span>
    </a>
  );
}

export default function ThreadMessages({
  convoId,
  meId,
  initial,
  otherUser,
  height = "60vh",
}: {
  convoId: string;
  meId: string;
  initial: Msg[];
  otherUser?: OtherUser | null;
  height?: number | string;
}) {
  const [msgs, setMsgs] = React.useState<Msg[]>(initial || []);
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const lastTsRef = React.useRef<number>(
    initial?.length ? new Date(initial[initial.length - 1].createdAt).getTime() : 0
  );
  const atBottomRef = React.useRef(true);

  const scrollToBottom = (smooth = true) => {
    const el = boxRef.current;
    if (!el) return;
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  };

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onScroll = () => {
      atBottomRef.current =
        el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    requestAnimationFrame(() => scrollToBottom(false));
    const fallbackTimer = setTimeout(() => scrollToBottom(false), 500);
    return () => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(fallbackTimer);
    };
  }, []);

  React.useEffect(() => {
    setMsgs(initial || []);
    lastTsRef.current = initial?.length
      ? new Date(initial[initial.length - 1].createdAt).getTime()
      : 0;
    requestAnimationFrame(() => scrollToBottom(false));
  }, [convoId, initial]);

  // Scroll to bottom after a message is sent. Also fire an immediate fetch
  // so the sent message appears within a few hundred ms instead of waiting
  // for the next 3s poll or SSE push.
  React.useEffect(() => {
    const onOk = async () => {
      try {
        const u = new URL(`/api/messages/${convoId}/list`, window.location.origin);
        if (lastTsRef.current) u.searchParams.set("since", String(lastTsRef.current));
        const res = await fetch(u.toString(), { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const fresh: Msg[] = Array.isArray(data?.messages) ? data.messages : [];
        if (fresh.length) {
          setMsgs((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const merged = [...prev, ...fresh.filter((m) => !seen.has(m.id))];
            lastTsRef.current = new Date(merged[merged.length - 1].createdAt).getTime();
            return merged;
          });
        }
      } catch {
        // Polling will catch up on the next tick.
      }
      setTimeout(() => {
        const el = boxRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }, 200);
    };
    document.addEventListener("actionform:ok", onOk);
    return () => document.removeEventListener("actionform:ok", onOk);
  }, [convoId]);

  React.useEffect(() => {
    let closed = false;
    let pollId: number | null = null;
    let pollController: AbortController | null = null;
    setStreamError(null);

    const apply = (fresh: Msg[]) => {
      if (!fresh.length) return;
      setMsgs((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const merged = [...prev, ...fresh.filter((m) => !seen.has(m.id))];
        lastTsRef.current = new Date(merged[merged.length - 1].createdAt).getTime();
        if (atBottomRef.current) requestAnimationFrame(() => scrollToBottom(true));
        return merged;
      });
    };

    const startPolling = () => {
      if (closed) return;
      pollId = window.setInterval(async () => {
        if (closed || pollController) return;
        const controller = new AbortController();
        pollController = controller;
        try {
          const u = new URL(`/api/messages/${convoId}/list`, window.location.origin);
          if (lastTsRef.current) u.searchParams.set("since", String(lastTsRef.current));
          const res = await fetch(u.toString(), { cache: "no-store", signal: controller.signal });
          if (closed) return;
          if (!res.ok) {
            if (isTerminalMessageStreamStatus(res.status)) {
              setStreamError(messageStreamStatusMessage(res.status));
              if (pollId) window.clearInterval(pollId);
              pollId = null;
            }
            return;
          }
          const data = await res.json();
          if (closed) return;
          apply(Array.isArray(data?.messages) ? data.messages : []);
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            console.warn("[thread-messages] polling failed", error);
          }
        } finally {
          if (pollController === controller) pollController = null;
        }
      }, 3000);
    };

    try {
      const u = new URL(`/api/messages/${convoId}/stream`, window.location.origin);
      if (lastTsRef.current) u.searchParams.set("since", String(lastTsRef.current));
      const es = new EventSource(u.toString());
      es.onmessage = (ev) => {
        const messages = parseThreadMessagesEvent(ev.data);
        if (messages) apply(messages);
      };
      es.onerror = () => {
        // SSE errors are noisy (visibility change, network blips, idle drops).
        // Silently fall back to polling instead of warning the user every time
        // the stream drops — only terminal polling failures (401/403/429) set
        // streamError below, and those are real interruptions worth surfacing.
        es.close();
        startPolling();
      };
      return () => {
        closed = true;
        es.close();
        if (pollId) window.clearInterval(pollId);
        pollController?.abort();
      };
    } catch (error) {
      console.warn("[thread-messages] event stream setup failed", error);
      startPolling();
      return () => {
        closed = true;
        if (pollId) window.clearInterval(pollId);
        pollController?.abort();
      };
    }
  }, [convoId]);

  const boxHeight = typeof height === "number" ? `${height}px` : height ?? "60vh";

  // Pre-compute which messages are the last in each consecutive "other" run
  // so we only show the avatar on the final bubble of a streak.
  const isLastInOtherRun = React.useMemo(() => {
    const result = new Set<string>();
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].senderId !== meId) {
        const isLast = i === msgs.length - 1 || msgs[i + 1].senderId === meId;
        if (isLast) result.add(msgs[i].id);
      }
    }
    return result;
  }, [msgs, meId]);

  const otherAvatar = otherUser?.avatarImageUrl ?? otherUser?.imageUrl ?? null;

  return (
    <div
      ref={boxRef}
      className="md:card-section md:p-4 overflow-y-auto pb-8"
      style={{ height: boxHeight }}
    >
      {streamError && (
        <div role="status" className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {streamError}
        </div>
      )}
      {msgs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-700 mb-4">
            <MessageCircle size={28} />
          </div>
          <h3 className="text-base font-medium text-neutral-800 mb-1">
            {otherUser?.name ? `Say hi to ${otherUser.name}` : "Start the conversation"}
          </h3>
          <p className="text-sm text-neutral-500 max-w-xs">
            Send the first message below. Replies appear here in real time.
          </p>
        </div>
      )}
      <ul className="space-y-3 pb-4">
        {msgs.map((m) => {
          const mine = m.senderId === meId;
          const body = (m.body ?? "").toString().trim();

          // ── Commission interest card ────────────────────────────────────
          if (m.kind === "commission_interest_card") {
            const card = parseCommissionInterestMessageBody(body);
            return (
              <li key={m.id} className="max-w-[90%]">
                <div className="border-l-4 border-teal-400 bg-neutral-50 p-4 space-y-2">
                  <div className="text-xs font-semibold text-teal-700 uppercase tracking-wide">Commission Interest</div>
                  <p className="text-sm text-neutral-700">
                    <strong>{card.sellerName ?? "A maker"}</strong> expressed interest in your commission request
                  </p>
                  {card.commissionTitle && (
                    <p className="text-sm font-medium text-neutral-900">&ldquo;{card.commissionTitle}&rdquo;</p>
                  )}
                  {(card.budgetMinCents || card.budgetMaxCents) && (
                    <p className="text-xs text-neutral-500">
                      Budget:{" "}
                      {card.budgetMinCents && card.budgetMaxCents
                        ? `$${(card.budgetMinCents / 100).toFixed(0)}–$${(card.budgetMaxCents / 100).toFixed(0)}`
                        : card.budgetMinCents
                        ? `From $${(card.budgetMinCents / 100).toFixed(0)}`
                        : `Up to $${(card.budgetMaxCents! / 100).toFixed(0)}`}
                    </p>
                  )}
                  {card.timeline && (
                    <p className="text-xs text-neutral-500">Timeline: {card.timeline}</p>
                  )}
                  {card.commissionId && (
                    <Link
                      href={`/commission/${card.commissionId}`}
                      className="inline-flex items-center gap-1 text-xs text-teal-700 underline hover:text-teal-900 mt-1"
                    >
                      View full request →
                    </Link>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  {new Date(m.createdAt).toLocaleString("en-US")}
                </div>
              </li>
            );
          }

          // ── Custom order request card ───────────────────────────────────
          if (m.kind === "custom_order_request") {
            const req = parseCustomOrderRequestMessageBody(body);
            const isSeller = !mine;
            return (
              <li key={m.id} className="max-w-[90%]">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
                  <div className="text-sm font-semibold text-amber-800 flex items-center gap-1.5"><Palette size={15} /> Custom Order Request</div>
                  {req.description && (
                    <p className="text-sm text-amber-900">{req.description}</p>
                  )}
                  {req.dimensions && (
                    <p className="text-xs text-amber-700">
                      <span className="font-medium">Dimensions:</span> {req.dimensions}
                    </p>
                  )}
                  {req.budget != null && (
                    <p className="text-xs text-amber-700">
                      <span className="font-medium">Budget:</span> ${req.budget}
                    </p>
                  )}
                  {req.timelineLabel && (
                    <p className="text-xs text-amber-700">
                      <span className="font-medium">Timeline:</span> {req.timelineLabel}
                    </p>
                  )}
                  {req.listingTitle && (
                    <p className="text-xs text-amber-700">
                      <span className="font-medium">Inspired by:</span> {req.listingTitle}
                    </p>
                  )}
                  {isSeller && (
                    <Link
                      href={`/dashboard/listings/custom?conversationId=${convoId}&buyerId=${m.senderId}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 mt-1"
                    >
                      Create Custom Listing →
                    </Link>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  {new Date(m.createdAt).toLocaleString("en-US")}
                </div>
              </li>
            );
          }

          // ── Custom order link card ──────────────────────────────────────
          if (m.kind === "custom_order_link") {
            const link = parseCustomOrderLinkMessageBody(body);
            return (
              <li key={m.id} className={`max-w-[90%] ${mine ? "ml-auto" : ""}`}>
                <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-2 shadow-sm">
                  <div className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5"><Logs size={15} /> Custom Piece Ready</div>
                  {link.title && (
                    <p className="text-sm font-medium text-neutral-700">{link.title}</p>
                  )}
                  {link.priceCents != null && (
                    <p className="text-sm text-neutral-600">
                      ${(link.priceCents / 100).toFixed(2)}{" "}
                      {(link.currency ?? "usd").toUpperCase()}
                    </p>
                  )}
                  {link.listingId && (
                    <Link
                      href={publicListingPath(link.listingId, link.title)}
                      className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 mt-1"
                    >
                      Purchase This Piece →
                    </Link>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  {new Date(m.createdAt).toLocaleString("en-US")}
                </div>
              </li>
            );
          }

          // ── Standard message rendering ──────────────────────────────────
          const file = parseFileMessageBody(body);

          const isImage = file
            ? (file.type?.startsWith("image/") ?? false) || isImageUrl(file.url)
            : isImageUrl(body);

          const isPdf = file
            ? file.type === "application/pdf" || isPdfUrl(file.url)
            : isPdfUrl(body);

          // Attachment bubbles are always light for readability
          const isAttachment = file || isImage || isPdf;
          const bubbleClass = isAttachment
            ? "bg-white text-neutral-900 border border-stone-200/60"
            : mine
            ? "bg-[#2C1F1A] text-white"
            : "bg-[#EFEAE0] text-neutral-900";

          let bubble: React.ReactNode;

          if (file) {
            if (isImage) {
              bubble = (
                <a href={file.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={file.url}
                    alt={file.name ?? "image"}
                    className="max-h-80 max-w-[260px] rounded-lg object-cover"
                  />
                </a>
              );
            } else if (isPdf) {
              bubble = <PdfChip url={file.url} name={file.name ?? undefined} />;
            } else {
              bubble = (
                <a
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  ⬇️ <span className="truncate max-w-[220px]">{file.name ?? "Download file"}</span>
                </a>
              );
            }
          } else if (isImage) {
            bubble = (
              <a href={body} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={body}
                  alt="attachment"
                  className="max-h-80 max-w-[260px] rounded-lg object-cover"
                />
              </a>
            );
          } else if (isPdf) {
            bubble = <PdfChip url={body} name={"Document.pdf"} />;
          } else {
            bubble = <div className="whitespace-pre-wrap break-words">{body}</div>;
          }

          const showAvatar = !mine && isLastInOtherRun.has(m.id);
          const avatarPlaceholder = !mine && !isLastInOtherRun.has(m.id);

          return (
            <li
              key={m.id}
              className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}
            >
              {/* Avatar slot for other person's messages */}
              {!mine && (
                <div className="shrink-0 w-8">
                  {showAvatar ? (
                    <div className="h-8 w-8 overflow-hidden rounded-full bg-neutral-200 ring-1 ring-neutral-200 shadow-sm">
                      {otherAvatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={otherAvatar} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                  ) : (
                    /* invisible spacer keeps bubbles aligned */
                    <div className="h-8 w-8" aria-hidden />
                  )}
                  {/* suppress lint warning on avatarPlaceholder — used implicitly above */}
                  {avatarPlaceholder && null}
                </div>
              )}

              <div className={`max-w-[75%] sm:max-w-[65%] ${mine ? "text-right" : ""}`}>
                <div className={`inline-block rounded-2xl px-3 py-2 text-left break-all ${bubbleClass}`}>
                  {bubble}
                </div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  {new Date(m.createdAt).toLocaleString("en-US")}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

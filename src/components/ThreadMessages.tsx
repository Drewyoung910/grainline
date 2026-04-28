"use client";

import * as React from "react";
import Link from "next/link";
import { Palette, Logs } from "@/components/icons";
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

function parseFilePayload(
  body: string
): { kind: "file"; url: string; name: string | null; type: string | null } | null {
  try {
    const obj = JSON.parse(body);
    if (obj && obj.kind === "file" && typeof obj.url === "string") {
      return {
        kind: "file",
        url: obj.url,
        name: obj.name ?? null,
        type: obj.type ?? null,
      };
    }
  } catch {}
  return null;
}

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

  // Scroll to bottom after a message is sent (waits for DOM render)
  React.useEffect(() => {
    const onOk = () => {
      setTimeout(() => {
        const el = boxRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }, 200);
    };
    document.addEventListener("actionform:ok", onOk);
    return () => document.removeEventListener("actionform:ok", onOk);
  }, []);

  React.useEffect(() => {
    let closed = false;
    let pollId: number | null = null;

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
        try {
          const u = new URL(`/api/messages/${convoId}/list`, window.location.origin);
          if (lastTsRef.current) u.searchParams.set("since", String(lastTsRef.current));
          const res = await fetch(u.toString(), { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          apply(Array.isArray(data?.messages) ? data.messages : []);
        } catch {}
      }, 3000);
    };

    try {
      const u = new URL(`/api/messages/${convoId}/stream`, window.location.origin);
      if (lastTsRef.current) u.searchParams.set("since", String(lastTsRef.current));
      const es = new EventSource(u.toString());
      es.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          if (payload?.type === "messages") apply(payload.messages as Msg[]);
        } catch {}
      };
      es.onerror = () => {
        es.close();
        startPolling();
      };
      return () => {
        closed = true;
        es.close();
        if (pollId) window.clearInterval(pollId);
      };
    } catch {
      startPolling();
      return () => {
        closed = true;
        if (pollId) window.clearInterval(pollId);
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
      className="md:rounded-xl md:border md:bg-white md:p-4 overflow-y-auto pb-8"
      style={{ height: boxHeight }}
    >
      <ul className="space-y-3 pb-4">
        {msgs.map((m) => {
          const mine = m.senderId === meId;
          const body = (m.body ?? "").toString().trim();

          // ── Commission interest card ────────────────────────────────────
          if (m.kind === "commission_interest_card") {
            let card: {
              commissionId?: string;
              commissionTitle?: string;
              sellerName?: string;
              budgetMinCents?: number | null;
              budgetMaxCents?: number | null;
              timeline?: string | null;
            } = {};
            try { card = JSON.parse(body); } catch {}
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
                <div className="mt-1 text-[11px] text-neutral-400">
                  {new Date(m.createdAt).toLocaleString("en-US")}
                </div>
              </li>
            );
          }

          // ── Custom order request card ───────────────────────────────────
          if (m.kind === "custom_order_request") {
            let req: {
              description?: string;
              dimensions?: string | null;
              budget?: number | null;
              timelineLabel?: string | null;
              listingTitle?: string | null;
            } = {};
            try { req = JSON.parse(body); } catch {}
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
            let link: {
              listingId?: string;
              title?: string;
              priceCents?: number;
              currency?: string;
            } = {};
            try { link = JSON.parse(body); } catch {}
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
          const file = parseFilePayload(body);

          const isImage = file
            ? (file.type?.startsWith("image/") ?? false) || isImageUrl(file.url)
            : isImageUrl(body);

          const isPdf = file
            ? file.type === "application/pdf" || isPdfUrl(file.url)
            : isPdfUrl(body);

          // Attachment bubbles are always light for readability
          const isAttachment = file || isImage || isPdf;
          const bubbleClass = isAttachment
            ? "bg-white text-neutral-900 border"
            : mine
            ? "bg-black text-white"
            : "bg-neutral-100";

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
                    <div className="h-8 w-8 rounded-full overflow-hidden bg-neutral-200">
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







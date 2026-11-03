"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import MediaImage from "@/components/MediaImage";
import MessageTime from "@/components/MessageTime";
import { avatarInitial } from "@/lib/avatarInitials";

type RailConversation = {
  id: string;
  title: string;
  avatarUrl: string | null;
  snippet: string;
  latestAt: string | null;
  unreadCount: number;
};

function parseConversations(value: unknown): RailConversation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const item = row as Partial<RailConversation> | null;
    if (!item || typeof item.id !== "string" || typeof item.title !== "string") return [];
    return [{
      id: item.id,
      title: item.title,
      avatarUrl: typeof item.avatarUrl === "string" ? item.avatarUrl : null,
      snippet: typeof item.snippet === "string" ? item.snippet : "",
      latestAt: typeof item.latestAt === "string" ? item.latestAt : null,
      unreadCount: typeof item.unreadCount === "number" ? item.unreadCount : 0,
    }];
  });
}

const DESKTOP = "(min-width: 1024px)";
const REFRESH_AFTER_SEND_MS = 500;

// The list beside an open thread, desktop only. It loads separately so opening
// a conversation never blanks it, and it refreshes when the thread changes,
// after sending and when the tab regains focus.
export default function ConversationRail() {
  const pathname = usePathname();
  const [conversations, setConversations] = React.useState<RailConversation[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const controllerRef = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    if (!window.matchMedia(DESKTOP).matches) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const res = await fetch("/api/messages/inbox", { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(`Inbox failed (${res.status})`);
      const data: { conversations?: unknown } = await res.json();
      if (controller.signal.aborted) return;
      setConversations(parseConversations(data.conversations));
      setFailed(false);
    } catch {
      // Keep whatever is already on screen; the thread itself still works.
      if (!controller.signal.aborted) setFailed(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load, pathname]);

  React.useEffect(() => {
    let timer: number | null = null;
    const afterSend = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), REFRESH_AFTER_SEND_MS);
    };
    const onFocus = () => void load();
    const media = window.matchMedia(DESKTOP);
    const onMedia = () => { if (media.matches) void load(); };
    document.addEventListener("actionform:ok", afterSend);
    window.addEventListener("focus", onFocus);
    media.addEventListener("change", onMedia);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("actionform:ok", afterSend);
      window.removeEventListener("focus", onFocus);
      media.removeEventListener("change", onMedia);
      controllerRef.current?.abort();
    };
  }, [load]);

  const currentId = pathname.split("/")[2] ?? null;

  return (
    <aside
      aria-label="Conversations"
      className="sticky top-[calc(var(--site-header-offset)+1rem)] mt-6 hidden max-h-[calc(100dvh-var(--site-header-offset)-2rem)] min-w-0 overflow-y-auto overscroll-contain rounded-2xl bg-[#EFEAE0] p-2 [scrollbar-width:none] lg:block [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex items-center justify-between px-2.5 pb-2 pt-1.5">
        <h2 className="font-display text-xl">Messages</h2>
        <Link href="/messages" className="text-sm text-neutral-600 underline-offset-4 hover:underline">All</Link>
      </div>
      {conversations === null && !failed && (
        <div aria-hidden="true" className="grid gap-1">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5">
              <div className="size-9 shrink-0 animate-pulse rounded-full bg-white/70 motion-reduce:animate-none" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/70 motion-reduce:animate-none" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-white/70 motion-reduce:animate-none" />
              </div>
            </div>
          ))}
        </div>
      )}
      {conversations === null && failed && (
        <p role="status" className="px-2.5 py-3 text-sm text-neutral-600">
          Couldn&apos;t load your conversations. <Link href="/messages" className="underline underline-offset-2">Open the inbox</Link>
        </p>
      )}
      {conversations !== null && (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          {conversations.map((conversation) => {
            const current = conversation.id === currentId;
            const unread = conversation.unreadCount > 0 && !current;
            return (
              <li key={conversation.id}>
                <Link
                  href={`/messages/${conversation.id}`}
                  aria-current={current ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 transition-colors duration-150 ${
                    current ? "bg-white shadow-[0_1px_0_rgba(44,31,26,0.08)]" : "hover:bg-[#E3DCCB]"
                  }`}
                >
                  <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white text-sm font-medium text-neutral-700">
                    {avatarInitial(conversation.title)}
                    {conversation.avatarUrl && (
                      <MediaImage
                        src={conversation.avatarUrl}
                        alt=""
                        width={36}
                        height={36}
                        loading="lazy"
                        className="absolute inset-0 size-9 object-cover"
                        fallbackClassName="hidden"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`min-w-0 truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>{conversation.title}</span>
                      {conversation.latestAt && (
                        <span className="shrink-0 text-[11px] text-neutral-500"><MessageTime date={conversation.latestAt} /></span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`min-w-0 flex-1 truncate text-[13px] ${unread ? "font-medium text-neutral-800" : "text-neutral-600"}`}>{conversation.snippet}</span>
                      {unread && (
                        <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#2C1F1A] px-1 text-[11px] tabular-nums text-[#FBF8F3]">
                          {conversation.unreadCount}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

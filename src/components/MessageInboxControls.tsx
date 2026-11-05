"use client";

import Link from "next/link";
import type { ChangeEvent } from "react";
import SegmentedControl from "@/components/SegmentedControl";
import { Search, X } from "@/components/icons";

export type MessageInboxTab = "inbox" | "unread" | "sent" | "archived";

function messageInboxHref(tab: MessageInboxTab, query: string): string {
  const params = new URLSearchParams();
  if (tab !== "inbox") params.set("tab", tab);
  if (query) params.set("q", query);
  const suffix = params.toString();
  return suffix ? `/messages?${suffix}` : "/messages";
}

function CountBadge({ children, tone }: { children: number; tone: "alert" | "neutral" }) {
  return (
    <span
      className={`ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums text-white ${
        tone === "alert" ? "bg-red-600" : "bg-[#2C1F1A]"
      }`}
    >
      {children > 99 ? "99+" : children}
    </span>
  );
}

export default function MessageInboxControls({
  tab,
  query,
  unreadTotal,
  awaitingReplyTotal,
  compact = false,
  onTabChange,
  onQueryChange,
}: {
  tab: MessageInboxTab;
  query: string;
  unreadTotal: number;
  awaitingReplyTotal: number;
  compact?: boolean;
  onTabChange?: (tab: MessageInboxTab) => void;
  onQueryChange?: (query: string) => void;
}) {
  const controlled = Boolean(onTabChange || onQueryChange);
  const clearHref = messageInboxHref(tab, "");
  const optionHref = (nextTab: MessageInboxTab) => controlled
    ? undefined
    : messageInboxHref(nextTab, query);

  return (
    <div className="grid min-w-0 gap-3">
      <SegmentedControl
        label="Conversations"
        value={tab}
        fullWidth
        size="sm"
        className="max-w-full"
        onChange={controlled ? (value) => onTabChange?.(value as MessageInboxTab) : undefined}
        options={[
          { value: "inbox", label: "Inbox", href: optionHref("inbox") },
          {
            value: "unread",
            href: optionHref("unread"),
            ariaLabel: unreadTotal > 0 ? `Unread, ${unreadTotal}` : "Unread",
            label: <span className="inline-flex items-center">Unread{unreadTotal > 0 && <CountBadge tone="alert">{unreadTotal}</CountBadge>}</span>,
          },
          {
            value: "sent",
            href: optionHref("sent"),
            ariaLabel: awaitingReplyTotal > 0 ? `Awaiting reply, ${awaitingReplyTotal}` : "Awaiting reply",
            label: (
              <span className="inline-flex items-center">
                Awaiting reply
                {awaitingReplyTotal > 0 && <CountBadge tone="neutral">{awaitingReplyTotal}</CountBadge>}
              </span>
            ),
          },
          { value: "archived", label: "Archived", href: optionHref("archived") },
        ]}
      />

      <form
        method="get"
        action="/messages"
        role="search"
        className="flex min-w-0 items-center gap-2"
        onSubmit={controlled ? (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onQueryChange?.(String(data.get("q") ?? ""));
        } : undefined}
      >
        {tab !== "inbox" && <input type="hidden" name="tab" value={tab} />}
        <div className="group/search flex min-h-11 min-w-0 flex-1 items-center overflow-hidden rounded-full border border-[#2C1F1A]/16 bg-white shadow-[0_4px_14px_-12px_rgba(44,31,26,0.75)] transition-[border-color,box-shadow] focus-within:border-[#2C1F1A]/28 focus-within:shadow-[0_10px_24px_-15px_rgba(44,31,26,0.9)]">
          <button
            type="submit"
            aria-label="Search messages"
            onPointerUp={(event) => event.currentTarget.blur()}
            className="group flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:text-neutral-900 focus-visible:outline-none"
          >
            <span className="flex size-9 items-center justify-center rounded-full transition-colors group-hover:bg-neutral-100 group-active:bg-neutral-200/70 group-focus-visible:bg-neutral-100">
              <Search size={17} />
            </span>
          </button>
          <label htmlFor={`message-search-${compact ? "rail" : "inbox"}`} className="sr-only">Search messages</label>
          <input
            id={`message-search-${compact ? "rail" : "inbox"}`}
            name="q"
            {...(controlled
              ? { value: query, onChange: (event: ChangeEvent<HTMLInputElement>) => onQueryChange?.(event.target.value) }
              : { defaultValue: query })}
            maxLength={200}
            placeholder="Search messages"
            className="min-w-0 flex-1 bg-transparent py-2 pr-2 text-sm outline-none focus-visible:shadow-none focus-visible:outline-none"
          />
          {query && controlled ? (
            <button
              type="button"
              onClick={() => onQueryChange?.("")}
              onPointerUp={(event) => event.currentTarget.blur()}
              aria-label="Clear message search"
              className="group flex min-h-11 min-w-11 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-neutral-700 focus-visible:outline-none"
            >
              <span className="flex size-9 items-center justify-center rounded-full transition-colors group-hover:bg-neutral-100 group-active:bg-neutral-200/70 group-focus-visible:bg-neutral-100">
                <X size={15} />
              </span>
            </button>
          ) : query ? (
            <Link
              href={clearHref}
              aria-label="Clear message search"
              className="group flex min-h-11 min-w-11 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-neutral-700 focus-visible:outline-none"
            >
              <span className="flex size-9 items-center justify-center rounded-full transition-colors group-hover:bg-neutral-100 group-active:bg-neutral-200/70 group-focus-visible:bg-neutral-100">
                <X size={15} />
              </span>
            </Link>
          ) : null}
        </div>
      </form>
    </div>
  );
}

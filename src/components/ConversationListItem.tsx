import Link from "next/link";
import MediaImage from "@/components/MediaImage";
import MessageTime from "@/components/MessageTime";
import { avatarInitial } from "@/lib/avatarInitials";

export default function ConversationListItem({
  id,
  title,
  avatarUrl,
  snippet,
  latestAt,
  unreadCount,
  current = false,
  archived = false,
  contextThumb = null,
}: {
  id: string;
  title: string;
  avatarUrl: string | null;
  snippet: string;
  latestAt: Date | string | null;
  unreadCount: number;
  current?: boolean;
  archived?: boolean;
  contextThumb?: string | null;
}) {
  const unread = unreadCount > 0 && !current;

  return (
    <li>
      <Link
        href={`/messages/${id}`}
        aria-current={current ? "page" : undefined}
        className={`flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-3 transition-[background-color,box-shadow] duration-150 ${
          current
            ? "bg-white shadow-[0_4px_14px_-12px_rgba(44,31,26,0.65)]"
            : "hover:bg-[#E3DCCB]/75"
        }`}
      >
        <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white text-sm font-medium text-neutral-700 ring-1 ring-[#2C1F1A]/8">
          {avatarInitial(title)}
          {avatarUrl && (
            <MediaImage
              src={avatarUrl}
              alt=""
              width={40}
              height={40}
              loading="lazy"
              className="absolute inset-0 size-10 object-cover"
              fallbackClassName="hidden"
            />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={`min-w-0 flex-1 truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>
              {title}
            </span>
            {latestAt && (
              <span className="shrink-0 whitespace-nowrap text-[11px] text-neutral-500">
                <MessageTime date={latestAt} />
              </span>
            )}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-2">
            <span className={`min-w-0 flex-1 truncate text-[13px] ${unread ? "font-medium text-neutral-800" : "text-neutral-600"}`}>
              {snippet}
            </span>
            {archived && (
              <span className="shrink-0 rounded-full bg-white/75 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
                Archived
              </span>
            )}
            {unread && (
              <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#2C1F1A] px-1 text-[11px] tabular-nums text-[#FBF8F3]">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </span>
        </span>

        {contextThumb && (
          <span className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-[#2C1F1A]/8">
            <MediaImage
              src={contextThumb}
              alt=""
              width={40}
              height={40}
              loading="lazy"
              className="size-10 object-cover"
              fallbackClassName="hidden"
            />
          </span>
        )}
      </Link>
    </li>
  );
}

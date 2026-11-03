"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart, Bell, Edit, EyeOff, Grid, Hammer, Heart, MessageCircle, Package, Rss, Search,
  Settings, Shield, Star, Store, Tag, User,
} from "@/components/icons";
import MediaImage from "@/components/MediaImage";
import { avatarInitial } from "@/lib/avatarInitials";
import { LOCAL_ACCOUNT_STATE_CLEARED_EVENT } from "@/lib/localAccountState";
import {
  accountNavGroups,
  currentWorkspaceHref,
  workshopNavGroups,
  type WorkspaceIcon,
  type WorkspaceKind,
  type WorkspaceNavItem,
} from "@/lib/workspaceNav";

const ICONS: Record<WorkspaceIcon, React.ComponentType<{ size?: number; className?: string }>> = {
  bell: Bell, chart: BarChart, edit: Edit, eyeOff: EyeOff, grid: Grid, hammer: Hammer, heart: Heart,
  message: MessageCircle, package: Package, rss: Rss, search: Search, settings: Settings,
  shield: Shield, star: Star, store: Store, tag: Tag, user: User,
};

// What the server hands over. Absent while it loads or if it fails; the links
// still work and only the name and badges are missing.
export type WorkspaceSidebarIdentity = Readonly<{
  personName: string;
  shopName: string | null;
  avatarUrl: string | null;
  hasSeller: boolean;
  guildLabel: string | null;
  counts: Readonly<{
    listings?: number | null;
    ordersToShip?: number | null;
    messages?: number | null;
    notifications?: number | null;
  }>;
}>;

function NavCount({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="ml-auto inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[#2C1F1A] px-1.5 text-xs tabular-nums text-[#FBF8F3]">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function SideLink({ item, current }: { item: WorkspaceNavItem; current: boolean }) {
  const Icon = ICONS[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={`flex min-h-10 items-center gap-2.5 rounded-xl px-3 py-1.5 text-[15px] transition-colors duration-150 ${
        current
          ? "bg-white font-medium text-neutral-900 shadow-[0_1px_0_rgba(44,31,26,0.08),0_6px_16px_-12px_rgba(0,0,0,0.4)]"
          : "text-neutral-600 hover:bg-[#EFEAE0] hover:text-neutral-900"
      }`}
    >
      <Icon size={18} className="shrink-0" />
      <span className="min-w-0 truncate">{item.label}</span>
      <NavCount count={item.count} />
    </Link>
  );
}

function PhoneLink({ item, current }: { item: WorkspaceNavItem; current: boolean }) {
  const Icon = ICONS[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm transition-colors duration-150 ${
        current ? "bg-[#2C1F1A] font-medium text-[#FBF8F3]" : "bg-[#EFEAE0] text-neutral-800"
      }`}
    >
      <Icon size={15} className="shrink-0" />
      {item.label}
      {item.count ? (
        <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] tabular-nums ${
          current ? "bg-[#FBF8F3] text-[#2C1F1A]" : "bg-[#2C1F1A] text-[#FBF8F3]"
        }`}>
          {item.count > 99 ? "99+" : item.count}
        </span>
      ) : null}
    </Link>
  );
}

// Set only in an effect, which never runs on the server, so one visitor's name
// can't reach another's page. It goes when the account does.
let lastIdentity: WorkspaceSidebarIdentity | null = null;
if (typeof window !== "undefined") {
  window.addEventListener(LOCAL_ACCOUNT_STATE_CLEARED_EVENT, () => {
    lastIdentity = null;
  });
}

export default function WorkspaceSidebar({
  kind,
  identity: identityProp = null,
}: {
  kind: WorkspaceKind;
  identity?: WorkspaceSidebarIdentity | null;
}) {
  const pathname = usePathname();
  // Workshop and My account are separate layouts, so moving between them mounts
  // this again and loads identity again. Show the last one until it arrives.
  React.useEffect(() => {
    if (identityProp) lastIdentity = identityProp;
  }, [identityProp]);
  const identity = identityProp ?? lastIdentity;
  const groups = kind === "workshop"
    ? workshopNavGroups({ counts: identity?.counts, guildLabel: identity?.guildLabel })
    : accountNavGroups({ counts: identity?.counts, hasSeller: identity ? identity.hasSeller : null });
  const current = currentWorkspaceHref(pathname, groups);
  const navLabel = kind === "workshop" ? "Workshop" : "My account";
  const displayName = kind === "workshop"
    ? identity?.shopName ?? identity?.personName ?? null
    : identity?.personName ?? null;

  // On phones the row scrolls sideways; keep the current page in view without
  // moving the page itself.
  const phoneRowRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const row = phoneRowRef.current;
    const active = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !active) return;
    row.scrollLeft = Math.max(0, active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2);
  }, [current]);

  return (
    <>
      {/* Phones and tablets */}
      <nav
        aria-label={navLabel}
        className="-mx-4 pt-4 sm:-mx-6 lg:hidden"
      >
        <div
          ref={phoneRowRef}
          className="relative flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden"
        >
          {groups.flatMap((group) => group.items).map((item) => (
            <PhoneLink key={item.href} item={item} current={current === item.href} />
          ))}
        </div>
      </nav>

      {/* Desktop: reserved space keeps the links still while the name loads. */}
      <aside
        aria-label={navLabel}
        className="sticky top-[calc(var(--site-header-offset)+1.25rem)] hidden max-h-[calc(100dvh-var(--site-header-offset)-2.5rem)] overflow-y-auto overscroll-contain pb-6 pt-8 [scrollbar-width:none] lg:block [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex min-h-[46px] items-center gap-3 px-1">
          {identity?.avatarUrl ? (
            <MediaImage
              src={identity.avatarUrl}
              alt=""
              width={46}
              height={46}
              className="size-[46px] shrink-0 rounded-full object-cover"
              fallbackClassName="size-[46px] shrink-0 rounded-full bg-[#EFEAE0]"
            />
          ) : (
            <span aria-hidden="true" className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-[#2C1F1A] font-medium text-[#FBF8F3]">
              {displayName ? avatarInitial(displayName) : ""}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium text-neutral-900">{displayName ?? navLabel}</p>
            <p className="text-[13px] text-neutral-500">{navLabel}</p>
          </div>
        </div>
        <div className="mt-2">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mx-3 mb-1.5 mt-4 text-xs font-semibold uppercase tracking-[0.06em] text-neutral-500">
                {group.label}
              </p>
              <div className="grid gap-0.5">
                {group.items.map((item) => (
                  <SideLink key={item.href} item={item} current={current === item.href} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

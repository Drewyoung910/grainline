"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import type { NotificationType } from "@prisma/client";
import {
  Bell,
  Package,
  MessageCircle,
  Heart,
  Wrench,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Star,
  Edit,
  User,
} from "@/components/icons";
import { safeNotificationPath } from "@/lib/notificationLinks";
import IconHoverTip from "@/components/IconHoverTip";
import { truncateText } from "@/lib/sanitize";

type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
};

const NOTIFICATION_CHANNEL = "grainline:notifications";
const MAX_NOTIFICATION_ITEMS = 20;
const MAX_UNREAD_COUNT = 999;

type NotificationSyncMessage =
  | { type: "all-read" }
  | { type: "read"; id: string };

function broadcastNotificationSync(message: NotificationSyncMessage) {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
  const channel = new BroadcastChannel(NOTIFICATION_CHANNEL);
  channel.postMessage(message);
  channel.close();
}

function typeIcon(type: NotificationType) {
  switch (type) {
    case "NEW_ORDER":
    case "ORDER_SHIPPED":
    case "ORDER_DELIVERED":
      return { Icon: Package, color: "text-green-600" };
    case "NEW_MESSAGE":
    case "CASE_MESSAGE":
      return { Icon: MessageCircle, color: "text-blue-600" };
    case "NEW_FAVORITE":
      return { Icon: Heart, color: "text-red-500" };
    case "CUSTOM_ORDER_REQUEST":
    case "CUSTOM_ORDER_LINK":
      return { Icon: Wrench, color: "text-amber-600" };
    case "CASE_OPENED":
    case "CASE_RESOLVED":
    case "REFUND_ISSUED":
    case "ACCOUNT_WARNING":
    case "LISTING_FLAGGED_BY_USER":
    case "PAYMENT_DISPUTE":
      return { Icon: AlertTriangle, color: "text-amber-500" };
    case "VERIFICATION_APPROVED":
      return { Icon: CheckCircle, color: "text-green-600" };
    case "VERIFICATION_REJECTED":
    case "PAYOUT_FAILED":
      return { Icon: XCircle, color: "text-red-500" };
    case "BACK_IN_STOCK":
    case "LOW_STOCK":
      return { Icon: Bell, color: "text-neutral-500" };
    case "NEW_REVIEW":
      return { Icon: Star, color: "text-amber-500" };
    case "NEW_BLOG_COMMENT":
    case "BLOG_COMMENT_REPLY":
    case "FOLLOWED_MAKER_NEW_BLOG":
      return { Icon: Edit, color: "text-neutral-500" };
    case "NEW_FOLLOWER":
      return { Icon: User, color: "text-neutral-500" };
    case "FOLLOWED_MAKER_NEW_LISTING":
    case "SELLER_BROADCAST":
      return { Icon: Bell, color: "text-teal-600" };
    case "COMMISSION_INTEREST":
      return { Icon: Wrench, color: "text-teal-600" };
    case "LISTING_APPROVED":
      return { Icon: CheckCircle, color: "text-green-600" };
    case "LISTING_REJECTED":
      return { Icon: XCircle, color: "text-red-500" };
    default:
      return { Icon: Bell, color: "text-neutral-500" };
  }
}

function isNotificationItem(value: unknown): value is NotificationItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<NotificationItem>;
  return (
    typeof item.id === "string" &&
    typeof item.type === "string" &&
    typeof item.title === "string" &&
    typeof item.body === "string" &&
    (typeof item.link === "string" || item.link === null) &&
    typeof item.read === "boolean" &&
    typeof item.createdAt === "string"
  );
}

function normalizeNotificationsResponse(data: unknown) {
  const payload = data && typeof data === "object"
    ? (data as { notifications?: unknown; unreadCount?: unknown })
    : {};
  const notifications = Array.isArray(payload.notifications)
    ? payload.notifications.filter(isNotificationItem).slice(0, MAX_NOTIFICATION_ITEMS)
    : [];
  const unreadCount =
    typeof payload.unreadCount === "number" && Number.isFinite(payload.unreadCount)
      ? Math.max(0, Math.min(MAX_UNREAD_COUNT, Math.floor(payload.unreadCount)))
      : 0;
  return { notifications, unreadCount };
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return "recently";
  const diff = Date.now() - timestamp;
  if (diff < -60000) return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationBell({
  initialUnreadCount,
  overlay = false,
}: {
  initialUnreadCount: number;
  overlay?: boolean;
}) {
  const { isLoaded, isSignedIn } = useUser();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  // Animated close, matching the mobile menu: play the pop-out animation,
  // then unmount, so the dropdown never vanishes in a single frame.
  const closeTimerRef = React.useRef<number | null>(null);
  const closeDropdown = React.useCallback(() => {
    if (!open) return;
    setClosing((alreadyClosing) => {
      if (alreadyClosing) return alreadyClosing;
      closeTimerRef.current = window.setTimeout(() => {
        setOpen(false);
        setClosing(false);
        closeTimerRef.current = null;
      }, 160);
      return true;
    });
  }, [open]);
  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(initialUnreadCount);
  const [loaded, setLoaded] = React.useState(false);
  const dropdownId = React.useId();
  const containerRef = React.useRef<HTMLDivElement>(null);

  const fetchNotifications = React.useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const normalized = normalizeNotificationsResponse(data);
      setNotifications(normalized.notifications);
      setUnreadCount(normalized.unreadCount);
      setLoaded(true);
    } catch {
      // ignore
    }
  }, [isLoaded, isSignedIn]);

  // Toggle dropdown + load
  const handleOpen = React.useCallback(() => {
    if (open) {
      closeDropdown();
      return;
    }
    setClosing(false);
    setOpen(true);
    if (!loaded) fetchNotifications();
  }, [open, closeDropdown, loaded, fetchNotifications]);

  // Fetch on mount to populate unread count immediately
  React.useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (!loaded) fetchNotifications();
  }, [loaded, fetchNotifications, isLoaded, isSignedIn]);

  React.useEffect(() => {
    if (!("BroadcastChannel" in window)) return;

    const channel = new BroadcastChannel(NOTIFICATION_CHANNEL);
    channel.onmessage = (event: MessageEvent<NotificationSyncMessage>) => {
      const message = event.data;
      if (message.type === "all-read") {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
      } else if (message.type === "read") {
        setNotifications((prev) =>
          prev.map((n) => (n.id === message.id ? { ...n, read: true } : n))
        );
        setUnreadCount((count) => Math.max(0, count - 1));
      }
    };

    return () => channel.close();
  }, []);

  // Smart polling: adapts interval based on user activity and tab visibility.
  // Active + recent activity: 60s. Idle > 5min: 5min. Background tab: 15min.
  // Idle > 30min: stop entirely. Resume on activity or tab focus: immediate fetch.
  const lastActivityRef = React.useRef(Date.now());
  const pollingStopped = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restart polling — called when activity resumes after a stop
  const restartPolling = React.useCallback(() => {
    if (!pollingStopped.current) return;
    pollingStopped.current = false;
    fetchNotifications();
    // schedulePoll is defined in the effect below and called via ref
    schedulePollRef.current?.();
  }, [fetchNotifications]);

  const schedulePollRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    const onActivity = () => {
      const now = Date.now();
      // Throttle: only update if > 10 seconds since last recorded activity
      if (now - lastActivityRef.current > 10_000) {
        lastActivityRef.current = now;
        // If polling was stopped due to 30min idle, restart it
        if (pollingStopped.current) {
          restartPolling();
        }
      }
    };
    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });
    window.addEventListener("click", onActivity, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("click", onActivity);
    };
  }, [restartPolling]);

  React.useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    function getInterval(): number | null {
      if (document.visibilityState === "hidden") return 15 * 60 * 1000; // 15 min
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs > 30 * 60 * 1000) return null; // > 30 min: stop polling
      if (idleMs > 5 * 60 * 1000) return 5 * 60 * 1000; // > 5 min: 5 min
      return 60 * 1000; // active: 60 seconds
    }

    function schedulePoll() {
      const interval = getInterval();
      if (interval === null) {
        // Stop polling — will be restarted by activity listener or visibility change
        pollingStopped.current = true;
        return;
      }
      pollingStopped.current = false;
      timerRef.current = setTimeout(() => {
        fetchNotifications();
        schedulePoll();
      }, interval);
    }

    schedulePollRef.current = schedulePoll;
    schedulePoll();

    // Tab refocused: immediate fetch + reschedule
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        lastActivityRef.current = Date.now();
        fetchNotifications();
        if (timerRef.current) clearTimeout(timerRef.current);
        schedulePoll();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isLoaded, isSignedIn, fetchNotifications]);

  // Close on Escape
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDropdown();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeDropdown]);

  // Close on outside click
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, closeDropdown]);

  React.useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open, closeDropdown]);

  const markAllRead = async () => {
    const previousNotifications = notifications;
    const previousUnreadCount = unreadCount;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) throw new Error("Failed to mark notifications read");
      broadcastNotificationSync({ type: "all-read" });
    } catch {
      setNotifications(previousNotifications);
      setUnreadCount(previousUnreadCount);
    }
  };

  const markRead = async (n: NotificationItem) => {
    const path = safeNotificationPath(n.link);
    if (!n.read) {
      const previousNotifications = notifications;
      const previousUnreadCount = unreadCount;
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        const res = await fetch(`/api/notifications/${n.id}/read`, { method: "POST" });
        if (!res.ok) throw new Error("Failed to mark notification read");
        broadcastNotificationSync({ type: "read", id: n.id });
      } catch {
        setNotifications(previousNotifications);
        setUnreadCount(previousUnreadCount);
        return;
      }
    }
    if (path) {
      closeDropdown();
      router.push(path);
    }
  };

  const notificationSurfaceClass = overlay
    ? "border border-white/30 bg-[#F7F5F0]/58 ring-1 ring-white/20 backdrop-blur-xl"
    : "ring-1 ring-black/5 bg-white";
  const notificationHeaderClass = overlay
    ? "border-b border-[#2C1F1A]/[0.12] bg-[#EFEAE0]/30"
    : "bg-[#EFEAE0] border-b border-stone-200/60";
  const notificationDividerClass = overlay
    ? "divide-[#2C1F1A]/10"
    : "divide-neutral-100";
  const notificationRowHoverClass = overlay
    ? "hover:bg-white/20"
    : "hover:bg-neutral-50";
  const notificationUnreadClass = overlay
    ? "border-l-[3px] border-amber-200 bg-amber-50/80"
    : "bg-[#EFEAE0]/50";
  const notificationReadClass = overlay
    ? "border-l-[3px] border-transparent"
    : "";
  const notificationMutedTextClass = overlay
    ? "text-neutral-800"
    : "text-neutral-500";
  const notificationFooterClass = overlay
    ? "border-t border-[#2C1F1A]/10"
    : "border-t border-neutral-100";

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={handleOpen}
        className="group relative inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-900 hover:bg-black/10 transition-colors"
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? dropdownId : undefined}
      >
        <Bell size={22} />
        {!open && <IconHoverTip label="Notifications" />}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-medium leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          id={dropdownId}
          role="dialog"
          aria-label="Notifications"
          data-home-notification-surface={overlay ? "true" : undefined}
          className={`fixed right-3 top-14 md:absolute md:right-0 md:top-8 z-50 w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto max-h-[70vh] rounded-2xl text-neutral-900 shadow-2xl motion-reduce:animate-none ${notificationSurfaceClass} ${
            closing ? "animate-menu-out pointer-events-none" : "animate-menu-in"
          }`}
        >
          {/* Header */}
          <div className={`flex items-center justify-between px-4 py-3 ${notificationHeaderClass}`}>
            <span className="text-sm font-semibold">Notifications</span>
            <button
              onClick={markAllRead}
              className={`text-xs underline hover:text-neutral-900 ${notificationMutedTextClass}`}
            >
              Mark all as read
            </button>
          </div>

          {/* List */}
          <ul className={`divide-y ${notificationDividerClass}`}>
            {!loaded ? (
              <li className={`px-4 py-6 text-center text-sm ${notificationMutedTextClass}`}>Loading…</li>
            ) : notifications.length === 0 ? (
              <li className={`px-4 py-6 text-center text-sm ${notificationMutedTextClass}`}>
                No notifications yet
              </li>
            ) : (
              notifications.map((n) => {
                const { Icon, color } = typeIcon(n.type);
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => markRead(n)}
                      className={`w-full text-left flex gap-3 px-4 py-3 ${notificationRowHoverClass} ${
                        !n.read ? notificationUnreadClass : notificationReadClass
                      }`}
                    >
                      <Icon size={16} className={`mt-0.5 shrink-0 ${color}`} />
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-[13px] leading-tight ${
                            overlay && !n.read ? "font-semibold text-amber-700" : "font-medium"
                          }`}
                        >
                          {overlay && !n.read && <span className="sr-only">Unread: </span>}
                          {n.title}
                        </p>
                        <p className={`mt-0.5 truncate text-xs ${notificationMutedTextClass}`}>
                          {truncateText(n.body, 60)}
                        </p>
                        <p className={`mt-0.5 text-[11px] ${notificationMutedTextClass}`}>
                          {timeAgo(n.createdAt)}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {/* Footer */}
          <div className={`px-4 py-2 ${notificationFooterClass}`}>
            <Link
              href="/dashboard/notifications"
              onClick={closeDropdown}
              className="block text-center text-xs font-medium text-neutral-700 hover:text-neutral-900 hover:underline"
            >
              See all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

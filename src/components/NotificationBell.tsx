"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
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

type NotificationType =
  | "NEW_MESSAGE"
  | "NEW_ORDER"
  | "ORDER_SHIPPED"
  | "ORDER_DELIVERED"
  | "CASE_OPENED"
  | "CASE_MESSAGE"
  | "CASE_RESOLVED"
  | "CUSTOM_ORDER_REQUEST"
  | "CUSTOM_ORDER_LINK"
  | "VERIFICATION_APPROVED"
  | "VERIFICATION_REJECTED"
  | "BACK_IN_STOCK"
  | "NEW_REVIEW"
  | "LOW_STOCK"
  | "NEW_FAVORITE"
  | "NEW_BLOG_COMMENT"
  | "BLOG_COMMENT_REPLY"
  | "NEW_FOLLOWER";

type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
};

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
      return { Icon: AlertTriangle, color: "text-amber-500" };
    case "VERIFICATION_APPROVED":
      return { Icon: CheckCircle, color: "text-green-600" };
    case "VERIFICATION_REJECTED":
      return { Icon: XCircle, color: "text-red-500" };
    case "BACK_IN_STOCK":
    case "LOW_STOCK":
      return { Icon: Bell, color: "text-neutral-500" };
    case "NEW_REVIEW":
      return { Icon: Star, color: "text-amber-500" };
    case "NEW_BLOG_COMMENT":
    case "BLOG_COMMENT_REPLY":
      return { Icon: Edit, color: "text-neutral-500" };
    case "NEW_FOLLOWER":
      return { Icon: User, color: "text-neutral-500" };
    default:
      return { Icon: Bell, color: "text-neutral-500" };
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
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
}: {
  initialUnreadCount: number;
}) {
  const { isSignedIn } = useUser();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(initialUnreadCount);
  const [loaded, setLoaded] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const fetchNotifications = React.useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
      setLoaded(true);
    } catch {
      // ignore
    }
  }, [isSignedIn]);

  // Open dropdown + load
  const handleOpen = React.useCallback(() => {
    setOpen((prev) => !prev);
    if (!loaded) fetchNotifications();
  }, [loaded, fetchNotifications]);

  // Fetch on mount to populate unread count immediately
  React.useEffect(() => {
    if (!isSignedIn) return;
    if (!loaded) fetchNotifications();
  }, [loaded, fetchNotifications, isSignedIn]);

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
    if (!isSignedIn) return;

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
  }, [isSignedIn, fetchNotifications]);

  // Close on Escape
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Close on outside click
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "POST" });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const markRead = async (n: NotificationItem) => {
    if (!n.read) {
      await fetch(`/api/notifications/${n.id}/read`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={handleOpen}
        className="relative inline-flex items-center text-neutral-800 hover:text-neutral-600"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[16px] rounded-full bg-red-600 px-1 text-[10px] font-medium leading-4 text-white text-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-4 top-14 md:absolute md:inset-x-auto md:right-0 md:top-8 z-50 min-w-[300px] max-w-[calc(100vw-2rem)] md:w-80 rounded-lg bg-white shadow-lg overflow-y-auto max-h-[70vh]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              onClick={markAllRead}
              className="text-xs text-neutral-500 hover:text-neutral-800 underline"
            >
              Mark all as read
            </button>
          </div>

          {/* List */}
          <ul className="divide-y divide-neutral-100">
            {!loaded ? (
              <li className="px-4 py-6 text-center text-sm text-neutral-400">Loading…</li>
            ) : notifications.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-neutral-400">
                No notifications yet
              </li>
            ) : (
              notifications.map((n) => {
                const { Icon, color } = typeIcon(n.type);
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => markRead(n)}
                      className={`w-full text-left flex gap-3 px-4 py-3 hover:bg-neutral-50 ${
                        !n.read ? "bg-amber-50" : ""
                      }`}
                    >
                      <Icon size={16} className={`mt-0.5 shrink-0 ${color}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium leading-tight">{n.title}</p>
                        <p className="text-xs text-neutral-500 mt-0.5 truncate">
                          {n.body.slice(0, 60)}
                        </p>
                        <p className="text-[11px] text-neutral-400 mt-0.5">
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
          <div className="border-t border-neutral-100 px-4 py-2">
            <Link
              href="/dashboard/notifications"
              onClick={() => setOpen(false)}
              className="block text-center text-xs text-blue-600 hover:underline"
            >
              See all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

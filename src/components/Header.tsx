// src/components/Header.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Show, useClerk } from "@clerk/nextjs";
import * as React from "react";
import MessageIconLink from "@/components/MessageIconLink";
import SearchBar from "@/components/SearchBar";
import NotificationBell from "@/components/NotificationBell";
import UserAvatarMenu from "@/components/UserAvatarMenu";
import { MessageCircle, ShoppingBag, Menu, X, Search, Rss, User } from "@/components/icons";

// Set to false to hide Commission Room from nav
const COMMISSION_ROOM_ENABLED = true;

export default function Header() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { signOut, openUserProfile } = useClerk();

  const [cartCount, setCartCount] = React.useState<number | null>(null);
  const [role, setRole] = React.useState<string | null>(null);
  const [hasSeller, setHasSeller] = React.useState(false);
  const [name, setName] = React.useState<string | null>(null);
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [avatarImageUrl, setAvatarImageUrl] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = React.useState(0);
  const [isLoggedIn, setIsLoggedIn] = React.useState(false);

  // Close drawer and search on navigation
  React.useEffect(() => {
    setDrawerOpen(false);
    setSearchOpen(false);
  }, [pathname, searchParams]);

  // Escape closes both drawer and search
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        setSearchOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Lock body scroll when drawer is open
  React.useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const loadCartCount = React.useCallback(async () => {
    try {
      const res = await fetch("/api/cart", { cache: "no-store" });
      if (!res.ok) {
        setCartCount(0);
        return;
      }
      const data = await res.json().catch(() => ({ items: [] as Array<{ quantity?: number }> }));
      const items: Array<{ quantity?: number }> = data?.items ?? [];
      const total = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
      setCartCount(total);
    } catch {
      setCartCount(0);
    }
  }, []);

  const loadNotifCount = React.useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setUnreadNotifCount(data.unreadCount ?? 0);
    } catch {
      // signed out or error — leave at 0
    }
  }, []);

  const loadAll = React.useCallback(async () => {
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (!res.ok) {
        setRole(null);
        setHasSeller(false);
        setName(null);
        setImageUrl(null);
        setAvatarImageUrl(null);
        setCartCount(0);
        setUnreadNotifCount(0);
        setIsLoggedIn(false);
        return;
      }
      const data = await res.json().catch(() => ({ role: null, hasSeller: false }));
      setRole(data?.role ?? null);
      setHasSeller(data?.hasSeller ?? false);
      setName(data?.name ?? null);
      setImageUrl(data?.imageUrl ?? null);
      setAvatarImageUrl(data?.avatarImageUrl ?? null);
      setIsLoggedIn(true);
      // Only fetch cart and notifications when signed in
      loadCartCount();
      loadNotifCount();
    } catch {
      setRole(null);
      setHasSeller(false);
      setIsLoggedIn(false);
    }
  }, [loadCartCount, loadNotifCount]);

  React.useEffect(() => {
    loadAll();
    const onUpdated = () => { if (isLoggedIn) loadCartCount(); };
    window.addEventListener("cart:updated", onUpdated);
    return () => window.removeEventListener("cart:updated", onUpdated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return (
    <header className="border-b bg-gradient-to-b from-amber-50 to-white relative z-30">
      <nav className="mx-auto max-w-6xl p-4 flex items-center gap-4">
        {/* Logo */}
        <Link href="/" className="shrink-0 flex items-center min-h-[44px]" aria-label="Grainline">
          {/* Mobile */}
          <img src="/logo-espresso.svg" alt="Grainline" className="h-7 w-auto md:hidden" />
          {/* Desktop */}
          <img src="/logo-espresso.svg" alt="Grainline" className="h-8 w-auto hidden md:block" />
        </Link>

        {/* Search bar — desktop only, always visible */}
        <span className="hidden md:flex flex-1 max-w-[400px]">
          <SearchBar />
        </span>

        {/* ── Desktop nav (md+) ────────────────────────────────────────── */}
        <div className="ml-auto hidden md:flex items-center gap-4">
          <Link href="/browse" className="text-neutral-800">
            Browse
          </Link>
          <Link href="/blog" className="text-neutral-800">
            Blog
          </Link>
          {COMMISSION_ROOM_ENABLED && (
            <Link href="/commission" className="text-neutral-800">
              Commission Room
            </Link>
          )}

          <Show when="signed-in">
            <NotificationBell initialUnreadCount={0} />
          </Show>

          <Show
            when="signed-in"
            fallback={
              <Link
                href="/sign-in?redirect_url=/messages"
                className="text-neutral-800"
                aria-label="Messages"
                title="Messages"
              >
                <MessageCircle size={20} />
              </Link>
            }
          >
            <MessageIconLink />
          </Show>

          {/* Cart — always visible; signed-out users see sign-in prompt on /cart */}
          <Link
            href="/cart"
            className="relative inline-flex items-center justify-center p-1 text-neutral-800"
            aria-label="Cart"
            title="Cart"
          >
            <ShoppingBag size={20} />
            {cartCount != null && cartCount > 0 && (
              <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-600 px-1.5 text-[11px] font-medium leading-5 text-white text-center">
                {cartCount}
              </span>
            )}
          </Link>

          <Show
            when="signed-in"
            fallback={
              <Link href="/sign-in" className="text-neutral-800">
                Sign in
              </Link>
            }
          >
            <UserAvatarMenu
              name={name}
              imageUrl={imageUrl}
              avatarImageUrl={avatarImageUrl}
              role={role}
              hasSeller={hasSeller}
            />
          </Show>
        </div>

        {/* ── Mobile right: search | bell | cart | hamburger (< md) ──────── */}
        <div className="ml-auto flex items-center gap-1 md:hidden">
          {/* Search toggle */}
          <button
            onClick={() => setSearchOpen((o) => !o)}
            aria-label={searchOpen ? "Close search" : "Search"}
            className="inline-flex items-center justify-center p-2 text-neutral-800 min-h-[44px] min-w-[44px]"
          >
            {searchOpen ? <X size={20} /> : <Search size={20} />}
          </button>

          {/* Notification bell */}
          <Show when="signed-in">
            <span className="inline-flex items-center justify-center min-h-[44px] min-w-[44px]">
              <NotificationBell initialUnreadCount={unreadNotifCount} />
            </span>
          </Show>

          {/* Cart — always visible */}
          <Link
            href="/cart"
            className="relative inline-flex items-center justify-center p-2 text-neutral-800 min-h-[44px] min-w-[44px]"
            aria-label="Cart"
          >
            <ShoppingBag size={20} />
            {cartCount != null && cartCount > 0 && (
              <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-red-600 px-1 text-[10px] font-medium leading-4 text-white text-center">
                {cartCount}
              </span>
            )}
          </Link>

          {/* Hamburger */}
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="inline-flex items-center justify-center p-2 text-neutral-800 min-h-[44px] min-w-[44px]"
          >
            <Menu size={24} />
          </button>
        </div>
      </nav>

      {/* ── Mobile search dropdown ─────────────────────────────────────── */}
      {searchOpen && (
        <>
          {/* Transparent backdrop — click outside closes the bar */}
          <div
            className="fixed inset-0 z-40 md:hidden"
            onClick={() => setSearchOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute top-full left-0 right-0 bg-white border-b shadow-sm p-3 z-50 md:hidden animate-slide-down">
            <SearchBar />
          </div>
        </>
      )}

      {/* ── Mobile drawer ─────────────────────────────────────────────── */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />

          {/* Panel */}
          <div className="fixed right-0 top-0 z-50 flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-2xl animate-slide-in-right rounded-l-2xl overflow-hidden">
            {/* Header row */}
            <div className="flex items-center justify-between border-b px-4 py-3">
              <Link
                href="/"
                className="flex items-center"
                aria-label="Grainline"
                onClick={() => setDrawerOpen(false)}
              >
                <img src="/logo-espresso.svg" alt="Grainline" className="h-7 w-auto" />
              </Link>
              {/* X button: relative z-[60] ensures it's above the fixed backdrop */}
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="relative z-[60] inline-flex items-center justify-center p-2 text-neutral-600 min-h-[44px] min-w-[44px]"
              >
                <X size={20} />
              </button>
            </div>

            {/* Nav links */}
            <div className="flex-1 overflow-y-auto py-2">
              <Link
                href="/browse"
                className="flex items-center gap-3 px-4 py-3 text-neutral-800 hover:bg-stone-50 min-h-[44px]"
                onClick={() => setDrawerOpen(false)}
              >
                Browse
              </Link>
              <Link
                href="/blog"
                className="flex items-center gap-3 px-4 py-3 text-neutral-800 hover:bg-stone-50 min-h-[44px]"
                onClick={() => setDrawerOpen(false)}
              >
                Blog
              </Link>
              {COMMISSION_ROOM_ENABLED && (
                <Link
                  href="/commission"
                  className="flex items-center gap-3 px-4 py-3 text-neutral-800 hover:bg-stone-50 min-h-[44px]"
                  onClick={() => setDrawerOpen(false)}
                >
                  Commission Room
                </Link>
              )}

              <Show when="signed-in">
                {/* My Account */}
                <Link
                  href="/account"
                  className="flex items-center gap-3 px-4 py-3 text-neutral-800 hover:bg-stone-50 min-h-[44px]"
                  onClick={() => setDrawerOpen(false)}
                >
                  <User size={18} />
                  My Account
                </Link>

                {/* Messages — single Link wrapping icon + text */}
                <Link
                  href="/messages"
                  className="flex items-center gap-3 px-4 py-3 text-neutral-800 hover:bg-stone-50 min-h-[44px]"
                  onClick={() => setDrawerOpen(false)}
                >
                  <span className="relative inline-flex items-center">
                    <MessageCircle size={18} />
                    {/* Unread badge is shown by UnreadBadge in the desktop MessageIconLink;
                        for the drawer we keep it simple with just the icon */}
                  </span>
                  Messages
                </Link>

                {/* Feed */}
                <Link
                  href="/account/feed"
                  className="flex items-center gap-3 px-4 py-3 text-neutral-800 hover:bg-stone-50 min-h-[44px]"
                  onClick={() => setDrawerOpen(false)}
                >
                  <Rss size={18} />
                  Your Feed
                </Link>

                {/* Workshop — only for sellers */}
                {hasSeller && (
                  <Link
                    href="/dashboard"
                    className="flex items-center gap-3 px-4 py-3 text-neutral-800 hover:bg-stone-50 min-h-[44px]"
                    onClick={() => setDrawerOpen(false)}
                  >
                    Workshop
                  </Link>
                )}

                {/* Admin (role-gated) */}
                {(role === "EMPLOYEE" || role === "ADMIN") && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-3 px-4 py-3 text-neutral-800 hover:bg-stone-50 min-h-[44px]"
                    onClick={() => setDrawerOpen(false)}
                  >
                    Admin
                  </Link>
                )}
              </Show>

              <Show when="signed-out">
                <Link
                  href="/sign-in"
                  className="flex items-center gap-3 px-4 py-3 text-neutral-800 hover:bg-stone-50 min-h-[44px]"
                  onClick={() => setDrawerOpen(false)}
                >
                  Sign in
                </Link>
              </Show>
            </div>

            {/* Avatar + inline actions at bottom — no dropdown to avoid overflow-hidden clipping */}
            <Show when="signed-in">
              <div className="border-t px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-1">
                {/* Avatar + name row — display only */}
                <div className="flex items-center gap-3 px-0 py-2">
                  <div className="h-9 w-9 rounded-full overflow-hidden bg-neutral-200 shrink-0 flex items-center justify-center">
                    {(avatarImageUrl ?? imageUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatarImageUrl ?? imageUrl ?? ""}
                        alt={name ?? ""}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-sm font-medium text-neutral-600 select-none">
                        {(name ?? "A").charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-medium text-neutral-700 truncate">{name ?? "Account"}</span>
                </div>

                {/* Manage Account — opens Clerk modal directly, no dropdown */}
                <button
                  type="button"
                  onClick={() => {
                    openUserProfile();
                    setDrawerOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-0 py-2.5 text-sm text-neutral-800 hover:text-neutral-600 min-h-[44px]"
                >
                  Manage Account
                </button>

                {/* Sign Out */}
                <button
                  type="button"
                  onClick={() => { signOut(); setDrawerOpen(false); }}
                  className="flex w-full items-center gap-3 px-0 py-2.5 text-sm text-red-600 hover:text-red-700 min-h-[44px]"
                >
                  Sign Out
                </button>
              </div>
            </Show>
          </div>
        </>
      )}
    </header>
  );
}

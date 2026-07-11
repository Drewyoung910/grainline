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
import { MessageCircle, ShoppingBag, Menu, X, Search, Rss, User, Store, Shield, Edit, Hammer } from "@/components/icons";
import { anonymousCartCount } from "@/lib/anonymousCart";
import { subscribeCartUpdated } from "@/lib/cartEvents";
import { clearSignedOutLocalAccountState } from "@/lib/localAccountState";
import { avatarInitial } from "@/lib/avatarInitials";

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
  const [drawerClosing, setDrawerClosing] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = React.useState(0);
  const [isLoggedIn, setIsLoggedIn] = React.useState(false);
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const cartCountRequestRef = React.useRef(0);
  const cartCountAbortRef = React.useRef<AbortController | null>(null);
  const notifCountRequestRef = React.useRef(0);
  const notifCountAbortRef = React.useRef<AbortController | null>(null);
  const loadAllRequestRef = React.useRef(0);
  const loadAllAbortRef = React.useRef<AbortController | null>(null);

  // Animated close: play the pop-out animation, then unmount. All user
  // close paths (X, backdrop, Escape, link taps) go through closeDrawer so
  // the menu never vanishes in a single frame.
  const drawerCloseTimerRef = React.useRef<number | null>(null);
  const closeDrawer = React.useCallback(() => {
    setDrawerClosing((alreadyClosing) => {
      if (alreadyClosing) return alreadyClosing;
      drawerCloseTimerRef.current = window.setTimeout(() => {
        setDrawerOpen(false);
        setDrawerClosing(false);
        drawerCloseTimerRef.current = null;
      }, 160);
      return true;
    });
  }, []);
  React.useEffect(() => {
    return () => {
      if (drawerCloseTimerRef.current !== null) {
        window.clearTimeout(drawerCloseTimerRef.current);
      }
    };
  }, []);

  // Popover focus, matching NotificationBell: move focus onto the card when
  // it opens, close it when keyboard focus leaves (see onBlur on the panel),
  // and let Escape close via the shared key handler below. Deliberately NO
  // focus trap and NO inert/aria-hidden toggling on #main-content — this is
  // a popover, not a modal, and flipping inert on the whole page forced
  // full-page recalcs that flashed on mobile open/close/navigation.
  React.useEffect(() => {
    if (!drawerOpen) return;
    const focusTimer = window.setTimeout(() => drawerRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [drawerOpen]);

  React.useEffect(() => {
    if (!drawerOpen) return;

    const canScrollDrawer = (target: EventTarget | null) => {
      const scrollRegion = drawerRef.current?.querySelector("[data-drawer-scroll-region]");
      return target instanceof Node && Boolean(scrollRegion?.contains(target));
    };
    const preventBackgroundScroll = (event: Event) => {
      if (!canScrollDrawer(event.target)) event.preventDefault();
    };

    document.addEventListener("wheel", preventBackgroundScroll, { passive: false });
    document.addEventListener("touchmove", preventBackgroundScroll, { passive: false });
    return () => {
      document.removeEventListener("wheel", preventBackgroundScroll);
      document.removeEventListener("touchmove", preventBackgroundScroll);
    };
  }, [drawerOpen]);

  const handleOpenUserProfile = React.useCallback(() => {
    try {
      openUserProfile();
      closeDrawer();
    } catch (error) {
      console.warn("[header] open user profile failed", error);
    }
  }, [openUserProfile, closeDrawer]);

  const handleSignOut = React.useCallback(async () => {
    closeDrawer();
    try {
      await signOut({ redirectUrl: "/" });
      clearSignedOutLocalAccountState();
    } catch (error) {
      console.warn("[header] sign out failed", error);
    }
  }, [signOut, closeDrawer]);

  // Close drawer and search on navigation (instant — new page context)
  React.useEffect(() => {
    setDrawerOpen(false);
    setDrawerClosing(false);
    setSearchOpen(false);
  }, [pathname, searchParams]);

  // Escape closes both drawer and search
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDrawer();
        setSearchOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeDrawer]);

  const loadCartCount = React.useCallback(async () => {
    cartCountAbortRef.current?.abort();
    const requestId = cartCountRequestRef.current + 1;
    cartCountRequestRef.current = requestId;
    const controller = new AbortController();
    cartCountAbortRef.current = controller;
    try {
      const res = await fetch("/api/cart", { cache: "no-store", signal: controller.signal });
      if (requestId !== cartCountRequestRef.current || controller.signal.aborted) return;
      if (!res.ok) {
        setCartCount(0);
        return;
      }
      const data = await res.json().catch(() => ({ items: [] as Array<{ quantity?: number }> }));
      if (requestId !== cartCountRequestRef.current || controller.signal.aborted) return;
      const items: Array<{ quantity?: number }> = data?.items ?? [];
      const total = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
      setCartCount(total);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      if (requestId !== cartCountRequestRef.current) return;
      setCartCount(0);
    } finally {
      if (cartCountAbortRef.current === controller) {
        cartCountAbortRef.current = null;
      }
    }
  }, []);

  const loadAnonymousCartCount = React.useCallback(() => {
    cartCountAbortRef.current?.abort();
    cartCountRequestRef.current += 1;
    setCartCount(anonymousCartCount());
  }, []);

  const loadNotifCount = React.useCallback(async () => {
    notifCountAbortRef.current?.abort();
    const requestId = notifCountRequestRef.current + 1;
    notifCountRequestRef.current = requestId;
    const controller = new AbortController();
    notifCountAbortRef.current = controller;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store", signal: controller.signal });
      if (requestId !== notifCountRequestRef.current || controller.signal.aborted) return;
      if (!res.ok) return;
      const data = await res.json();
      if (requestId !== notifCountRequestRef.current || controller.signal.aborted) return;
      setUnreadNotifCount(data.unreadCount ?? 0);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      // signed out or error — leave at 0
    } finally {
      if (notifCountAbortRef.current === controller) {
        notifCountAbortRef.current = null;
      }
    }
  }, []);

  const loadAll = React.useCallback(async () => {
    loadAllAbortRef.current?.abort();
    const requestId = loadAllRequestRef.current + 1;
    loadAllRequestRef.current = requestId;
    const controller = new AbortController();
    loadAllAbortRef.current = controller;
    try {
      const res = await fetch("/api/me", { cache: "no-store", signal: controller.signal });
      if (requestId !== loadAllRequestRef.current || controller.signal.aborted) return;
      if (!res.ok) {
        setRole(null);
        setHasSeller(false);
        setName(null);
        setImageUrl(null);
        setAvatarImageUrl(null);
        loadAnonymousCartCount();
        setUnreadNotifCount(0);
        setIsLoggedIn(false);
        return;
      }
      const data = await res.json().catch(() => ({ role: null, hasSeller: false }));
      if (requestId !== loadAllRequestRef.current || controller.signal.aborted) return;
      setRole(data?.role ?? null);
      setHasSeller(data?.hasSeller ?? false);
      setName(data?.name ?? null);
      setImageUrl(data?.imageUrl ?? null);
      setAvatarImageUrl(data?.avatarImageUrl ?? null);
      setIsLoggedIn(true);
      // Only fetch cart and notifications when signed in
      loadCartCount();
      loadNotifCount();
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      if (requestId !== loadAllRequestRef.current) return;
      setRole(null);
      setHasSeller(false);
      setIsLoggedIn(false);
    } finally {
      if (loadAllAbortRef.current === controller) {
        loadAllAbortRef.current = null;
      }
    }
  }, [loadAnonymousCartCount, loadCartCount, loadNotifCount]);

  React.useEffect(() => {
    loadAll();
  }, [loadAll]);

  React.useEffect(() => {
    return () => {
      loadAllAbortRef.current?.abort();
      cartCountAbortRef.current?.abort();
      notifCountAbortRef.current?.abort();
    };
  }, []);

  React.useEffect(() => {
    const onUpdated = () => {
      if (isLoggedIn) loadCartCount();
      else loadAnonymousCartCount();
    };
    return subscribeCartUpdated(onUpdated);
  }, [isLoggedIn, loadAnonymousCartCount, loadCartCount]);

  return (
    <header className="bg-[#F7F5F0] text-neutral-900 border-b border-stone-200 relative z-[50]">
      <nav aria-label="Main navigation" className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8 flex items-center gap-4 lg:gap-6">
        {/* Logo */}
        <Link href="/" className="shrink-0 flex items-center min-h-[44px]" aria-label="Grainline home">
          {/* Mobile */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-espresso.svg" alt="Grainline" className="h-7 w-auto md:hidden" />
          {/* Desktop */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-espresso.svg" alt="Grainline" className="h-8 w-auto hidden md:block" />
        </Link>

        {/* Search bar — desktop only, fluid width with a larger cap so it
            has real presence in the header. */}
        <span className="hidden md:flex flex-1 max-w-[820px]">
          <SearchBar />
        </span>

        {/* ── Desktop nav (md+) ────────────────────────────────────────── */}
        <div className="ml-auto hidden md:flex items-center gap-2 lg:gap-3">
          <Link
            href="/browse"
            className="inline-flex items-center px-3 py-2 rounded-full text-sm font-medium text-neutral-900 hover:bg-black/10 hover:text-black transition-colors"
          >
            Browse
          </Link>
          <Link
            href="/blog"
            className="inline-flex items-center px-3 py-2 rounded-full text-sm font-medium text-neutral-900 hover:bg-black/10 hover:text-black transition-colors"
          >
            Blog
          </Link>
          <Link
            href="/commission"
            className="inline-flex items-center px-3 py-2 rounded-full text-sm font-medium text-neutral-900 hover:bg-black/10 hover:text-black transition-colors"
          >
            Commission Room
          </Link>

          <Show when="signed-in">
            <NotificationBell initialUnreadCount={0} />
          </Show>

          <Show
            when="signed-in"
            fallback={
              <Link
                href="/sign-in?redirect_url=/messages"
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-900 hover:bg-black/10 transition-colors"
                aria-label="Messages"
                title="Messages"
              >
                <MessageCircle size={22} />
              </Link>
            }
          >
            <MessageIconLink />
          </Show>

          {/* Cart — always visible; signed-out users see sign-in prompt on /cart */}
          <Link
            href="/cart"
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-900 hover:bg-black/10 transition-colors"
            aria-label="Cart"
            title="Cart"
          >
            <ShoppingBag size={22} />
            {cartCount != null && cartCount > 0 && (
              <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-medium leading-none text-white">
                {cartCount}
              </span>
            )}
          </Link>

          <Show
            when="signed-in"
            fallback={
              <Link
                href="/sign-in"
                className="inline-flex items-center px-4 py-2 rounded-full text-sm font-medium text-neutral-900 hover:bg-black/10 hover:text-black transition-colors"
              >
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
            className="inline-flex items-center justify-center p-2 text-neutral-900 hover:bg-black/10 rounded-full min-h-[44px] min-w-[44px]"
          >
            {searchOpen ? <X size={20} /> : <Search size={20} />}
          </button>

          {/* Notification bell */}
          <Show when="signed-in">
            <span className="inline-flex items-center justify-center min-h-[44px] min-w-[44px]">
              <NotificationBell initialUnreadCount={unreadNotifCount} />
            </span>
          </Show>

          {/* Cart — always visible. Two-layer structure mirrors
              NotificationBell + MessageIconLink: outer Link is the 44×44
              tap target, inner span is the 36×36 visible hover circle.
              Badge is positioned -top-1 -right-1 on the inner span (NOT
              the outer Link) so all three mobile badges sit at the same
              vertical position in the header row. */}
          <Link
            href="/cart"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px]"
            aria-label="Cart"
          >
            <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-900 hover:bg-black/10 transition-colors">
              <ShoppingBag size={20} />
              {cartCount != null && cartCount > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-medium leading-none text-white">
                  {cartCount}
                </span>
              )}
            </span>
          </Link>

          {/* Hamburger */}
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="inline-flex items-center justify-center p-2 text-neutral-900 hover:bg-black/10 rounded-full min-h-[44px] min-w-[44px]"
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
          <div className="absolute top-full left-0 right-0 bg-[#F7F5F0] border-b border-stone-200 shadow-sm p-3 z-50 md:hidden animate-slide-down">
            <SearchBar />
          </div>
        </>
      )}

      {/* ── Mobile drawer ─────────────────────────────────────────────── */}
      {drawerOpen && (
        <>
          {/* Click-catcher — TRANSPARENT on purpose. A painted full-screen
              overlay (bg-black/30) compositing in/out is what made mobile
              Safari's top/bottom browser bars flash on open, close, and
              navigation; the notifications popover has no painted backdrop
              and no flash. touch-none still swallows scroll gestures here. */}
          <div
            className="fixed inset-0 z-[1000] touch-none"
            onClick={closeDrawer}
            aria-hidden="true"
          />

          {/* Panel — floating card anchored top-right, sized to content */}
          <div
            ref={drawerRef}
            role="dialog"
            aria-label="Main navigation"
            tabIndex={-1}
            onBlur={(e) => {
              // Close when keyboard focus leaves the popover (popover
              // pattern). relatedTarget is null for pointer taps on
              // non-focusable areas — the click-catcher handles those.
              if (
                e.relatedTarget instanceof Node &&
                drawerRef.current &&
                !drawerRef.current.contains(e.relatedTarget)
              ) {
                closeDrawer();
              }
            }}
            className={`fixed right-3 top-14 z-[1001] flex w-64 max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-4.5rem)] flex-col rounded-2xl bg-[#F7F5F0] shadow-2xl ring-1 ring-black/5 overflow-hidden overscroll-contain outline-none motion-reduce:animate-none ${
              drawerClosing ? "animate-menu-out pointer-events-none" : "animate-menu-in"
            }`}
          >
            {/* Header strip — darker cream to anchor the drawer */}
            <div className="flex items-center justify-between bg-[#EFEAE0] border-b border-stone-200/60 px-4 py-3">
              <Link
                href="/"
                className="flex items-center"
                aria-label="Grainline home"
                onClick={closeDrawer}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo-espresso.svg"
                  alt="Grainline"
                  className="h-6 w-auto"
                />
              </Link>
              {/* X button: relative z-[60] ensures it's above the fixed backdrop */}
              <button
                onClick={closeDrawer}
                aria-label="Close menu"
                className="relative z-[60] inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-600 hover:bg-black/10"
              >
                <X size={20} />
              </button>
            </div>

            {/* Nav links */}
            <nav data-drawer-scroll-region className="flex-1 overflow-y-auto overscroll-contain px-2 py-3">
              <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Explore
              </div>
              <Link
                href="/browse"
                className="flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 hover:bg-[#EFEAE0]"
                onClick={closeDrawer}
              >
                <Search size={18} className="text-neutral-500" />
                Browse
              </Link>
              <Link
                href="/blog"
                className="flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 hover:bg-[#EFEAE0]"
                onClick={closeDrawer}
              >
                <Edit size={18} className="text-neutral-500" />
                Blog
              </Link>
              <Link
                href="/commission"
                className="flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 hover:bg-[#EFEAE0]"
                onClick={closeDrawer}
              >
                <Hammer size={18} className="text-neutral-500" />
                Commission Room
              </Link>

              <Show when="signed-in">
                <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  Your account
                </div>

                <Link
                  href="/account"
                  className="flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 hover:bg-[#EFEAE0]"
                  onClick={closeDrawer}
                >
                  <User size={18} className="text-neutral-500" />
                  My Account
                </Link>

                {/* Messages — single Link wrapping icon + text */}
                <Link
                  href="/messages"
                  className="flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 hover:bg-[#EFEAE0]"
                  onClick={closeDrawer}
                >
                  <MessageCircle size={18} className="text-neutral-500" />
                  Messages
                </Link>

                {/* Feed */}
                <Link
                  href="/account/feed"
                  className="flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 hover:bg-[#EFEAE0]"
                  onClick={closeDrawer}
                >
                  <Rss size={18} className="text-neutral-500" />
                  Your Feed
                </Link>

                {/* Workshop — only for sellers; Start Selling otherwise */}
                {hasSeller ? (
                  <Link
                    href="/dashboard"
                    className="flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 hover:bg-[#EFEAE0]"
                    onClick={closeDrawer}
                  >
                    <Store size={18} className="text-neutral-500" />
                    Workshop
                  </Link>
                ) : (
                  <Link
                    href="/dashboard"
                    className="flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] font-medium text-neutral-900 hover:bg-[#EFEAE0]"
                    onClick={closeDrawer}
                  >
                    <Store size={18} className="text-neutral-500" />
                    Start Selling
                  </Link>
                )}

                {/* Admin (role-gated) */}
                {(role === "EMPLOYEE" || role === "ADMIN") && (
                  <Link
                    href="/admin"
                    className="flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 hover:bg-[#EFEAE0]"
                    onClick={closeDrawer}
                  >
                    <Shield size={18} className="text-neutral-500" />
                    Admin
                  </Link>
                )}
              </Show>

              <Show when="signed-out">
                <div className="px-3 pt-4">
                  <Link
                    href="/sign-in"
                    className="flex min-h-[44px] items-center justify-center rounded-full bg-[#2C1F1A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3A2A24] transition-colors"
                    onClick={closeDrawer}
                  >
                    Sign in
                  </Link>
                </div>
              </Show>
            </nav>

            {/* Avatar + inline actions at bottom — no dropdown to avoid overflow-hidden clipping */}
            <Show when="signed-in">
              <div className="border-t border-stone-200/60 bg-white px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                {/* Avatar + name row — display only */}
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-200 ring-1 ring-neutral-200">
                    {(avatarImageUrl ?? imageUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatarImageUrl ?? imageUrl ?? ""}
                        alt={name ?? ""}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-sm font-medium text-neutral-600 select-none">
                        {avatarInitial(name, "A")}
                      </span>
                    )}
                  </div>
                  <span className="truncate text-sm font-medium text-neutral-800">{name ?? "Account"}</span>
                </div>

                {/* Manage Account — opens Clerk modal directly, no dropdown */}
                <button
                  type="button"
                  onClick={handleOpenUserProfile}
                  className="flex min-h-[44px] w-full items-center rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-[#F7F5F0]"
                >
                  Manage Account
                </button>

                {/* Sign Out */}
                <button
                  type="button"
                  onClick={() => {
                    void handleSignOut();
                  }}
                  className="flex min-h-[44px] w-full items-center rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50"
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

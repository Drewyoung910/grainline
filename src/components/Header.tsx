// src/components/Header.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Show, useClerk, useUser } from "@clerk/nextjs";
import * as React from "react";
import MessageIconLink from "@/components/MessageIconLink";
import IconHoverTip from "@/components/IconHoverTip";
import SearchBar from "@/components/SearchBar";
import NotificationBell from "@/components/NotificationBell";
import UserAvatarMenu from "@/components/UserAvatarMenu";
import { MessageCircle, ShoppingBag, Menu, X, Search, Rss, User, Store, Shield, Edit, Wrench } from "@/components/icons";
import { anonymousCartCount } from "@/lib/anonymousCart";
import { subscribeCartUpdated } from "@/lib/cartEvents";
import { clearSignedOutLocalAccountState } from "@/lib/localAccountState";
import { avatarInitial } from "@/lib/avatarInitials";

export default function Header() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const drawerItemHover = isHome ? "hover:bg-white/20" : "hover:bg-[#EFEAE0]";
  const drawerSectionText = isHome ? "text-neutral-700" : "text-neutral-400";
  const drawerIconText = isHome ? "text-neutral-700" : "text-neutral-500";
  const searchParams = useSearchParams();
  const { signOut, openUserProfile } = useClerk();
  // Clerk auth state — used to re-fetch /api/me when the session appears or
  // disappears client-side. Without this, signing in could leave the header
  // showing stale signed-out data (e.g. "Start Selling" for an established
  // seller) until a hard refresh.
  const { isSignedIn } = useUser();

  const [cartCount, setCartCount] = React.useState<number | null>(null);
  const [role, setRole] = React.useState<string | null>(null);
  const [hasSeller, setHasSeller] = React.useState(false);
  const [name, setName] = React.useState<string | null>(null);
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [avatarImageUrl, setAvatarImageUrl] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [drawerClosing, setDrawerClosing] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchClosing, setSearchClosing] = React.useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = React.useState(0);
  const [isLoggedIn, setIsLoggedIn] = React.useState(false);
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const drawerNavRef = React.useRef<HTMLElement>(null);
  const [drawerNavFade, setDrawerNavFade] = React.useState(false);
  // Bottom fade = "there's more below" affordance. Shown while the menu's
  // scroll region overflows and isn't scrolled to the end.
  const updateDrawerNavFade = React.useCallback(() => {
    const el = drawerNavRef.current;
    if (!el) return;
    setDrawerNavFade(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  }, []);
  React.useEffect(() => {
    if (!drawerOpen) return;
    const measure = window.setTimeout(updateDrawerNavFade, 0);
    window.addEventListener("resize", updateDrawerNavFade);
    return () => {
      window.clearTimeout(measure);
      window.removeEventListener("resize", updateDrawerNavFade);
    };
  }, [drawerOpen, updateDrawerNavFade]);
  const drawerId = React.useId();
  const mobileSearchId = React.useId();
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
  const mobileSearchCloseTimerRef = React.useRef<number | null>(null);
  const clearDrawerCloseTimer = React.useCallback(() => {
    if (drawerCloseTimerRef.current !== null) {
      window.clearTimeout(drawerCloseTimerRef.current);
      drawerCloseTimerRef.current = null;
    }
  }, []);
  const clearMobileSearchCloseTimer = React.useCallback(() => {
    if (mobileSearchCloseTimerRef.current !== null) {
      window.clearTimeout(mobileSearchCloseTimerRef.current);
      mobileSearchCloseTimerRef.current = null;
    }
  }, []);
  const closeDrawer = React.useCallback(() => {
    if (!drawerOpen) return;
    setDrawerClosing((alreadyClosing) => {
      if (alreadyClosing) return alreadyClosing;
      drawerCloseTimerRef.current = window.setTimeout(() => {
        setDrawerOpen(false);
        setDrawerClosing(false);
        drawerCloseTimerRef.current = null;
      }, 160);
      return true;
    });
  }, [drawerOpen]);
  const openDrawer = React.useCallback(() => {
    clearDrawerCloseTimer();
    setDrawerClosing(false);
    setDrawerOpen(true);
  }, [clearDrawerCloseTimer]);
  const closeMobileSearch = React.useCallback(() => {
    if (!searchOpen) return;
    setSearchClosing((alreadyClosing) => {
      if (alreadyClosing) return alreadyClosing;
      mobileSearchCloseTimerRef.current = window.setTimeout(() => {
        setSearchOpen(false);
        setSearchClosing(false);
        mobileSearchCloseTimerRef.current = null;
      }, 140);
      return true;
    });
  }, [searchOpen]);
  const openMobileSearch = React.useCallback(() => {
    clearMobileSearchCloseTimer();
    setSearchClosing(false);
    setSearchOpen(true);
  }, [clearMobileSearchCloseTimer]);
  React.useEffect(() => {
    return () => {
      clearDrawerCloseTimer();
      clearMobileSearchCloseTimer();
    };
  }, [clearDrawerCloseTimer, clearMobileSearchCloseTimer]);

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
      if (!(target instanceof Node) || !scrollRegion?.contains(target)) return false;
      // Only allow the gesture when the region actually overflows. If it
      // fits (taller PWA viewport), iOS would scroll-chain the gesture to
      // the page behind — exactly the bug this guards against.
      return scrollRegion.scrollHeight > scrollRegion.clientHeight + 1;
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
    clearDrawerCloseTimer();
    clearMobileSearchCloseTimer();
    setDrawerOpen(false);
    setDrawerClosing(false);
    setSearchOpen(false);
    setSearchClosing(false);
  }, [pathname, searchParams, clearDrawerCloseTimer, clearMobileSearchCloseTimer]);

  // Escape closes both drawer and search
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDrawer();
        closeMobileSearch();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeDrawer, closeMobileSearch]);

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
  }, [loadAll, isSignedIn]);

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
    <header
      className={`${isHome ? "absolute inset-x-0 top-0 bg-transparent" : "relative bg-[#F7F5F0]"} z-[50] text-neutral-900`}
      data-home-overlay={isHome ? "true" : undefined}
    >
      <nav
        aria-label="Main navigation"
        className={`mx-auto flex max-w-[1600px] items-center gap-2 px-3 sm:px-6 ${
          isHome
            ? "pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pb-4 sm:pt-[calc(1rem+env(safe-area-inset-top))] lg:gap-12 lg:pb-5 lg:pl-10 lg:pr-8 lg:pt-[calc(1.25rem+env(safe-area-inset-top))] xl:gap-16 xl:pl-14 xl:pr-10"
            : "py-3 sm:py-4 lg:gap-5 lg:px-8 lg:py-5"
        }`}
      >
        {/* Logo */}
        <Link
          href="/"
          className={`flex min-h-[44px] shrink-0 items-center ${isHome ? "drop-shadow-[0_2px_12px_rgba(0,0,0,0.28)]" : ""}`}
          aria-label="Grainline home"
        >
          {isHome ? (
            <span
              aria-hidden="true"
              data-home-logo-mark
              className="hero-logo-mark block h-5 w-[92px] min-[360px]:h-6 min-[360px]:w-[111px] sm:h-7 sm:w-[129px] lg:h-8 lg:w-[148px]"
            />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-espresso.svg"
                alt="Grainline"
                className="h-5 w-auto min-[360px]:h-6 sm:h-7 lg:hidden"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-espresso.svg"
                alt="Grainline"
                className="hidden h-8 w-auto lg:block"
              />
            </>
          )}
        </Link>

        {/* Search and navigation share one quiet floating surface on the
            homepage. Other pages keep the same controls in normal flow. */}
        <div
          data-home-header-surface={isHome ? "true" : undefined}
          className={`hidden min-w-0 flex-1 items-center gap-3 lg:flex ${
            isHome
              ? "relative isolate p-2"
              : ""
          }`}
        >
          {isHome && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 rounded-2xl border border-white/25 bg-[#F7F5F0]/26 shadow-[0_16px_50px_rgba(12,10,9,0.12)] backdrop-blur-lg"
            />
          )}
          <span data-header-search-slot className="flex min-w-[220px] flex-1">
            <SearchBar overlay={isHome} />
          </span>

          {/* ── Desktop nav (lg+) ──────────────────────────────────────── */}
          <div data-header-actions className="flex items-center gap-1 xl:gap-2">
          <Link
            href="/browse"
            className="inline-flex items-center rounded-full px-2 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-black/10 hover:text-black xl:px-3"
          >
            Browse
          </Link>
          <Link
            href="/blog"
            className="inline-flex items-center rounded-full px-2 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-black/10 hover:text-black xl:px-3"
          >
            Blog
          </Link>
          <Link
            href="/commission"
            className="inline-flex items-center rounded-full px-2 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-black/10 hover:text-black xl:px-3"
          >
            Commission Room
          </Link>

          <Show when="signed-in">
            <NotificationBell initialUnreadCount={0} overlay={isHome} />
          </Show>

          <Show
            when="signed-in"
            fallback={
              <Link
                href="/sign-in?redirect_url=/messages"
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-900 hover:bg-black/10 transition-colors"
                aria-label="Messages"
              >
                <MessageCircle size={22} />
                <IconHoverTip label="Messages" />
              </Link>
            }
          >
            <MessageIconLink />
          </Show>

          {/* Cart — always visible; signed-out users see sign-in prompt on /cart */}
          <Link
            href="/cart"
            className="group relative inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-900 hover:bg-black/10 transition-colors"
            aria-label="Cart"
          >
            <ShoppingBag size={22} />
            <IconHoverTip label="Cart" />
            {cartCount != null && cartCount > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-medium leading-none text-white">
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
              overlay={isHome}
            />
          </Show>
          </div>
        </div>

        {/* ── Mobile/tablet right: search | bell | cart | menu (< lg) ───── */}
        <div
          className={`ml-auto flex items-center gap-0.5 lg:hidden ${
            isHome
              ? "relative isolate p-0.5"
              : ""
          }`}
        >
          {isHome && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 rounded-2xl border border-white/20 bg-[#F7F5F0]/22 shadow-[0_10px_32px_rgba(12,10,9,0.12)] backdrop-blur-lg"
            />
          )}
          {/* Search toggle */}
          <button
            onClick={() => {
              if (searchOpen) closeMobileSearch();
              else openMobileSearch();
            }}
            aria-label={searchOpen ? "Close search" : "Search"}
            aria-expanded={searchOpen}
            aria-controls={mobileSearchId}
            className="inline-flex items-center justify-center p-2 text-neutral-900 hover:bg-black/10 rounded-full min-h-[44px] min-w-[44px]"
          >
            {searchOpen ? <X size={20} /> : <Search size={20} />}
          </button>

          {/* Notification bell */}
          <Show when="signed-in">
            <span className="inline-flex items-center justify-center min-h-[44px] min-w-[44px]">
              <NotificationBell initialUnreadCount={unreadNotifCount} overlay={isHome} />
            </span>
          </Show>

          {/* Cart — always visible. Two-layer structure mirrors
              NotificationBell + MessageIconLink: outer Link is the 44×44
              tap target, inner span is the 40×40 visible hover circle.
              Badge is positioned -top-1 -right-1 on the inner span (NOT
              the outer Link) so all three mobile badges sit at the same
              vertical position in the header row. */}
          <Link
            href="/cart"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px]"
            aria-label="Cart"
          >
            <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-900 hover:bg-black/10 transition-colors">
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
            onClick={openDrawer}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
            aria-controls={drawerOpen ? drawerId : undefined}
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
            className="fixed inset-0 z-40 lg:hidden"
            onClick={closeMobileSearch}
            aria-hidden="true"
          />
          <div
            id={mobileSearchId}
            data-mobile-search-popup
            className={`absolute left-3 right-3 top-[calc(100%+0.25rem)] z-50 bg-transparent p-0 shadow-none lg:hidden motion-reduce:animate-none sm:left-6 sm:right-6 ${
              searchClosing ? "animate-search-pop-out pointer-events-none" : "animate-search-pop-in"
            }`}
          >
            <SearchBar autoFocus overlay={isHome} />
          </div>
        </>
      )}

      {/* ── Mobile drawer ─────────────────────────────────────────────── */}
      {drawerOpen && (
        <>
          {/* Click-catcher — transparent on purpose. A painted full-screen
              overlay compositing in/out is what made mobile
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
            id={drawerId}
            data-home-menu-surface={isHome ? "true" : undefined}
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
            className={`fixed right-3 top-14 z-[1001] flex w-64 max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-4.5rem)] flex-col overflow-hidden overscroll-contain rounded-2xl shadow-2xl outline-none motion-reduce:animate-none ${
              isHome
                ? "border border-white/30 bg-[#F7F5F0]/58 ring-1 ring-white/20 backdrop-blur-xl"
                : "bg-[#F7F5F0] ring-1 ring-black/5"
            } ${
              drawerClosing ? "animate-menu-out pointer-events-none" : "animate-menu-in"
            }`}
          >
            {/* Slim header row — no logo (it's already in the site header
                next to the hamburger); saves height so more menu rows are
                visible before scrolling. */}
            <div
              className={`flex items-center justify-between border-b pl-5 pr-2 py-1 ${
                isHome
                  ? "border-[#2C1F1A]/[0.12] bg-[#EFEAE0]/30"
                  : "border-stone-200/60 bg-[#EFEAE0]"
              }`}
            >
              <span className="text-sm font-semibold">
                Menu
              </span>
              <button
                onClick={closeDrawer}
                aria-label="Close menu"
                className="relative z-[60] inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-600 hover:bg-black/10"
              >
                <X size={18} />
              </button>
            </div>

            {/* Nav links */}
            <div className="relative flex min-h-0 flex-1 flex-col">
              <nav
                ref={drawerNavRef}
                data-drawer-scroll-region
                onScroll={updateDrawerNavFade}
                className="flex-1 overflow-y-auto overscroll-contain px-2 py-3"
              >
                <div className={`px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider ${drawerSectionText}`}>
                  Explore
                </div>
                <Link
                  href="/browse"
                  className={`flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 ${drawerItemHover}`}
                  onClick={closeDrawer}
                >
                  <Search size={18} className={drawerIconText} />
                  Browse
                </Link>
                <Link
                  href="/blog"
                  className={`flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 ${drawerItemHover}`}
                  onClick={closeDrawer}
                >
                  <Edit size={18} className={drawerIconText} />
                  Blog
                </Link>
                <Link
                  href="/commission"
                  className={`flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 ${drawerItemHover}`}
                  onClick={closeDrawer}
                >
                  <Wrench size={18} className={drawerIconText} />
                  Commission Room
                </Link>

                <Show when="signed-in">
                  <div className={`px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider ${drawerSectionText}`}>
                    Your account
                  </div>

                  <Link
                    href="/account"
                    className={`flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 ${drawerItemHover}`}
                    onClick={closeDrawer}
                  >
                    <User size={18} className={drawerIconText} />
                    My Account
                  </Link>

                  {/* Messages — single Link wrapping icon + text */}
                  <Link
                    href="/messages"
                    className={`flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 ${drawerItemHover}`}
                    onClick={closeDrawer}
                  >
                    <MessageCircle size={18} className={drawerIconText} />
                    Messages
                  </Link>

                  {/* Feed */}
                  <Link
                    href="/account/feed"
                    className={`flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 ${drawerItemHover}`}
                    onClick={closeDrawer}
                  >
                    <Rss size={18} className={drawerIconText} />
                    Your Feed
                  </Link>

                  {/* Workshop — only for sellers; Start Selling otherwise */}
                  {hasSeller ? (
                    <Link
                      href="/dashboard"
                      className={`flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 ${drawerItemHover}`}
                      onClick={closeDrawer}
                    >
                      <Store size={18} className={drawerIconText} />
                      Workshop
                    </Link>
                  ) : (
                    <Link
                      href="/dashboard"
                      className={`flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] font-medium text-neutral-900 ${drawerItemHover}`}
                      onClick={closeDrawer}
                    >
                      <Store size={18} className={drawerIconText} />
                      Start Selling
                    </Link>
                  )}

                  {/* Admin (role-gated) */}
                  {(role === "EMPLOYEE" || role === "ADMIN") && (
                    <Link
                      href="/admin"
                      className={`flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-[15px] text-neutral-800 ${drawerItemHover}`}
                      onClick={closeDrawer}
                    >
                      <Shield size={18} className={drawerIconText} />
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
              {drawerNavFade && (
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent ${
                    isHome
                      ? "from-[#F7F5F0]/70 via-[#F7F5F0]/35"
                      : "from-[#F7F5F0] via-[#F7F5F0]/75"
                  }`}
                />
              )}
            </div>

            {/* Avatar + inline actions at bottom — no dropdown to avoid overflow-hidden clipping */}
            <Show when="signed-in">
              <div
                className={`border-t px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] ${
                  isHome
                    ? "border-[#2C1F1A]/[0.12] bg-[#F7F5F0]/38"
                    : "border-stone-200/60 bg-white"
                }`}
              >
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
                  className={`flex min-h-[44px] w-full items-center rounded-md px-3 py-2 text-sm text-neutral-700 ${
                    isHome ? "hover:bg-white/20" : "hover:bg-[#F7F5F0]"
                  }`}
                >
                  Manage Account
                </button>

                {/* Sign Out */}
                <button
                  type="button"
                  onClick={() => {
                    void handleSignOut();
                  }}
                  className={`flex min-h-[44px] w-full items-center rounded-md px-3 py-2 text-sm text-red-600 ${
                    isHome ? "hover:bg-red-50/40" : "hover:bg-red-50"
                  }`}
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

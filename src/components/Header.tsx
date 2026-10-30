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
  const drawerItemHover = "hover:bg-[#EFEAE0]";
  const drawerSectionText = "text-neutral-400";
  const drawerIconText = "text-neutral-500";
  const searchParams = useSearchParams();
  // The header is clear over the homepage photo until the visitor scrolls,
  // then settles into the same frosted paper every other page uses.
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    if (!isHome) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setScrolled(window.scrollY > 24);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [isHome]);
  const clear = isHome && !scrolled;
  const { signOut, openUserProfile } = useClerk();
  // Clerk auth state — used to re-fetch /api/me when the session appears or
  // disappears client-side. Without this, signing in could leave the header
  // showing stale signed-out data (e.g. "Start Selling" for an established
  // seller) until a hard refresh. It also gates the signed-in-only cart and
  // notification requests: /api/me answers 200 for signed-out visitors, so
  // its status alone cannot tell a guest from a member.
  const { isLoaded, isSignedIn } = useUser();

  const [cartCount, setCartCount] = React.useState<number | null>(null);
  // Bumps the cart badge when a cart change raises the count. Page loads and
  // signing in or out reload the count without a bump.
  const [cartBumpCount, setCartBumpCount] = React.useState(0);
  const cartCountRef = React.useRef<number | null>(null);
  const cartCountBeforeChangeRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    cartCountRef.current = cartCount;
    const before = cartCountBeforeChangeRef.current;
    if (before === null || cartCount === null || cartCount === before) return;
    cartCountBeforeChangeRef.current = null;
    if (cartCount > before) setCartBumpCount((count) => count + 1);
  }, [cartCount]);
  React.useEffect(() => {
    cartCountBeforeChangeRef.current = null;
  }, [isSignedIn]);
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
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  // Set when the menu closes while focus was inside it (or already dropped
  // to <body>), so focus returns to the hamburger instead of being lost.
  // Left unset when focus moved somewhere else on purpose (Tab out, Clerk's
  // account modal).
  const restoreMenuFocusRef = React.useRef(false);
  const shouldRestoreMenuFocus = React.useCallback(() => {
    if (typeof document === "undefined") return false;
    const active = document.activeElement;
    return !active || active === document.body || Boolean(drawerRef.current?.contains(active));
  }, []);
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
        restoreMenuFocusRef.current = shouldRestoreMenuFocus();
        setDrawerOpen(false);
        setDrawerClosing(false);
        drawerCloseTimerRef.current = null;
      }, 160);
      return true;
    });
  }, [drawerOpen, shouldRestoreMenuFocus]);
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

  // Every close path (X, Escape, click-catcher, link taps, navigation)
  // returns focus to the hamburger once the menu has unmounted.
  React.useEffect(() => {
    if (drawerOpen || !restoreMenuFocusRef.current) return;
    restoreMenuFocusRef.current = false;
    menuButtonRef.current?.focus();
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
    if (drawerRef.current) restoreMenuFocusRef.current = shouldRestoreMenuFocus();
    clearDrawerCloseTimer();
    clearMobileSearchCloseTimer();
    setDrawerOpen(false);
    setDrawerClosing(false);
    setSearchOpen(false);
    setSearchClosing(false);
  }, [pathname, searchParams, clearDrawerCloseTimer, clearMobileSearchCloseTimer, shouldRestoreMenuFocus]);

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
    const showSignedOutState = () => {
      notifCountAbortRef.current?.abort();
      notifCountRequestRef.current += 1;
      setRole(null);
      setHasSeller(false);
      setName(null);
      setImageUrl(null);
      setAvatarImageUrl(null);
      loadAnonymousCartCount();
      setUnreadNotifCount(0);
    };
    // Wait for Clerk before choosing which cart to count, and never call
    // the signed-in-only /api/cart and /api/notifications for guests.
    if (!isLoaded) return;
    if (!isSignedIn) {
      showSignedOutState();
      return;
    }
    const controller = new AbortController();
    loadAllAbortRef.current = controller;
    try {
      const res = await fetch("/api/me", { cache: "no-store", signal: controller.signal });
      if (requestId !== loadAllRequestRef.current || controller.signal.aborted) return;
      if (!res.ok) {
        showSignedOutState();
        return;
      }
      const data = await res.json().catch(() => ({ role: null, hasSeller: false }));
      if (requestId !== loadAllRequestRef.current || controller.signal.aborted) return;
      // Every account has a role; a null role means the server saw no
      // session yet, so the signed-in-only endpoints would answer 401.
      if (!data?.role) {
        showSignedOutState();
        return;
      }
      setRole(data?.role ?? null);
      setHasSeller(data?.hasSeller ?? false);
      setName(data?.name ?? null);
      setImageUrl(data?.imageUrl ?? null);
      setAvatarImageUrl(data?.avatarImageUrl ?? null);
      // Only fetch cart and notifications when signed in
      loadCartCount();
      loadNotifCount();
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      if (requestId !== loadAllRequestRef.current) return;
      setRole(null);
      setHasSeller(false);
    } finally {
      if (loadAllAbortRef.current === controller) {
        loadAllAbortRef.current = null;
      }
    }
  }, [isLoaded, isSignedIn, loadAnonymousCartCount, loadCartCount, loadNotifCount]);

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
      cartCountBeforeChangeRef.current = cartCountRef.current;
      if (isSignedIn) loadCartCount();
      else loadAnonymousCartCount();
    };
    return subscribeCartUpdated(onUpdated);
  }, [isSignedIn, loadAnonymousCartCount, loadCartCount]);

  const iconButtonClass =
    "group relative inline-flex h-10 w-10 items-center justify-center rounded-full text-current transition-[background-color,scale] duration-200 ease-out hover:bg-current/10 motion-safe:active:scale-[0.92]";
  const navLinkClass = (href: string) => {
    const current = pathname === href || pathname.startsWith(`${href}/`);
    return `relative py-1 text-[15px] font-medium text-current after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-0.5 after:h-[1.5px] after:origin-left after:bg-current after:transition-transform after:duration-300 after:ease-[cubic-bezier(0.2,0.7,0.2,1)] hover:after:scale-x-100 ${
      current ? "after:scale-x-100" : "after:scale-x-0"
    }`;
  };
  const navLinkCurrent = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`) ? "page" as const : undefined;

  return (
    <header
      data-header-state={clear ? "clear" : "frosted"}
      className={`${isHome ? "fixed" : "sticky"} inset-x-0 top-0 z-[50] pt-[env(safe-area-inset-top)] transition-colors duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
        clear ? "text-[#F5EFE6]" : "text-neutral-900"
      }`}
    >
      {/* Frosted paper lives on its own layer: a backdrop-filter on the
          header itself would trap the menu's fixed click-catcher inside the
          header's box. It fades in as the homepage scrolls past the photo. */}
      <span
        aria-hidden="true"
        data-header-frost
        className={`pointer-events-none absolute inset-0 -z-10 bg-[#F7F5F0]/85 shadow-[0_1px_0_rgba(44,31,26,0.12)] backdrop-blur-xl backdrop-saturate-150 transition-opacity duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
          clear ? "opacity-0" : "opacity-100"
        }`}
      />
      <nav
        aria-label="Main navigation"
        className={`mx-auto flex max-w-[1600px] items-center gap-2 px-3 transition-[padding] duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] sm:px-6 lg:gap-6 lg:px-8 xl:gap-8 ${
          clear ? "py-4 lg:py-5" : "py-2.5 lg:py-3"
        }`}
      >
        {/* Logo: one mask so its color can follow the header from cream over
            the photo to espresso on frosted paper. */}
        <Link
          href="/"
          className="flex min-h-[44px] shrink-0 items-center"
          aria-label="Grainline home"
        >
          <span
            aria-hidden="true"
            data-site-logo-mark
            className={`logo-mark block h-5 w-[92px] transition-[background-color] duration-500 min-[360px]:h-6 min-[360px]:w-[111px] sm:h-7 sm:w-[129px] lg:h-8 lg:w-[148px] ${
              clear ? "bg-[#E5DFD2]" : "bg-[#2C1F1A]"
            }`}
          />
        </Link>

        {/* ── Desktop (lg+): search, nav, tools ─────────────────────────── */}
        <div className="hidden min-w-0 flex-1 items-center gap-6 lg:flex xl:gap-8">
          <span data-header-search-slot className="flex min-w-[220px] max-w-[640px] flex-1">
            <SearchBar tone={clear ? "glass" : "solid"} />
          </span>

          <div data-header-nav className="flex shrink-0 items-center gap-6">
            <Link href="/browse" aria-current={navLinkCurrent("/browse")} className={navLinkClass("/browse")}>
              Browse
            </Link>
            <Link href="/blog" aria-current={navLinkCurrent("/blog")} className={navLinkClass("/blog")}>
              Blog
            </Link>
            <Link href="/commission" aria-current={navLinkCurrent("/commission")} className={navLinkClass("/commission")}>
              Commission Room
            </Link>
          </div>

          <div data-header-actions className="ml-auto flex shrink-0 items-center gap-1">
            <Show when="signed-in">
              <NotificationBell initialUnreadCount={0} />
            </Show>

            <Show when="signed-in">
              <MessageIconLink />
            </Show>

            {/* Cart — always visible; signed-out users see sign-in prompt on /cart */}
            <Link href="/cart" className={iconButtonClass} aria-label="Cart" data-cart-target="">
              <ShoppingBag size={22} />
              <IconHoverTip label="Cart" />
              {cartCount != null && cartCount > 0 && (
                <span key={cartBumpCount} className={`absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-medium leading-none text-white${cartBumpCount > 0 ? " badge-bump" : ""}`}>
                  {cartCount}
                </span>
              )}
            </Link>

            <Show
              when="signed-in"
              fallback={
                <Link
                  href="/sign-in"
                  className="ml-1.5 inline-flex h-10 items-center rounded-full border border-current/35 px-4 text-sm font-medium text-current transition-[background-color,border-color,scale] duration-200 hover:bg-current/10 motion-safe:active:scale-[0.97]"
                >
                  Sign in
                </Link>
              }
            >
              <span className="ml-1.5 inline-flex">
                <UserAvatarMenu
                  name={name}
                  imageUrl={imageUrl}
                  avatarImageUrl={avatarImageUrl}
                  role={role}
                  hasSeller={hasSeller}
                />
              </span>
            </Show>
          </div>
        </div>

        {/* ── Mobile/tablet right: search | bell | cart | menu (< lg) ───── */}
        <div className="ml-auto flex items-center gap-0.5 lg:hidden">
          {/* Search toggle */}
          <button
            onClick={() => {
              if (searchOpen) closeMobileSearch();
              else openMobileSearch();
            }}
            aria-label={searchOpen ? "Close search" : "Search"}
            aria-expanded={searchOpen}
            aria-controls={mobileSearchId}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2 text-current transition-[background-color,scale] duration-200 hover:bg-current/10 motion-safe:active:scale-[0.92]"
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
              tap target, inner span is the 40×40 visible hover circle.
              Badge is positioned -top-1 -right-1 on the inner span (NOT
              the outer Link) so all three mobile badges sit at the same
              vertical position in the header row. */}
          <Link
            href="/cart"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px]"
            aria-label="Cart"
            data-cart-target=""
          >
            <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-current transition-[background-color,scale] duration-200 hover:bg-current/10 motion-safe:active:scale-[0.92]">
              <ShoppingBag size={20} />
              {cartCount != null && cartCount > 0 && (
                <span key={cartBumpCount} className={`absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-medium leading-none text-white${cartBumpCount > 0 ? " badge-bump" : ""}`}>
                  {cartCount}
                </span>
              )}
            </span>
          </Link>

          {/* Hamburger */}
          <button
            ref={menuButtonRef}
            onClick={openDrawer}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
            aria-controls={drawerOpen ? drawerId : undefined}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2 text-current transition-[background-color,scale] duration-200 hover:bg-current/10 motion-safe:active:scale-[0.92]"
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
            className={`absolute left-3 right-3 top-[calc(100%+0.5rem)] z-50 lg:hidden motion-reduce:animate-none sm:left-6 sm:right-6 ${
              searchClosing ? "animate-search-pop-out pointer-events-none" : "animate-search-pop-in"
            }`}
          >
            <SearchBar autoFocus tone="solid" />
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
            ref={drawerRef}
            role="dialog"
            aria-label="Menu"
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
            className={`fixed right-3 top-[calc(var(--site-header-h)+0.375rem+env(safe-area-inset-top))] z-[1001] flex w-64 max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-4.5rem)] flex-col overflow-hidden overscroll-contain rounded-2xl bg-[#F7F5F0] text-neutral-900 shadow-2xl ring-1 ring-black/5 outline-none motion-reduce:animate-none ${
              drawerClosing ? "animate-menu-out pointer-events-none" : "animate-menu-in"
            }`}
          >
            {/* Slim header row — no logo (it's already in the site header
                next to the hamburger); saves height so more menu rows are
                visible before scrolling. */}
            <div
              className="flex items-center justify-between border-b border-stone-200/60 bg-[#EFEAE0] py-1 pl-5 pr-2"
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
                aria-label="Site"
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
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#F7F5F0] via-[#F7F5F0]/75 to-transparent"
                />
              )}
            </div>

            {/* Avatar + inline actions at bottom — no dropdown to avoid overflow-hidden clipping */}
            <Show when="signed-in">
              <div
                className="border-t border-stone-200/60 bg-white px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
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

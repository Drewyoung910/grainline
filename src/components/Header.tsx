// src/components/Header.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Show, UserButton } from "@clerk/nextjs";
import * as React from "react";
import MessageIconLink from "@/components/MessageIconLink";
import SearchBar from "@/components/SearchBar";
import NotificationBell from "@/components/NotificationBell";
import { MessageCircle, ShoppingBag } from "@/components/icons";

export default function Header() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showSearch = pathname === "/" || pathname.startsWith("/browse");

  // ⬇️ Cart count state
  const [cartCount, setCartCount] = React.useState<number | null>(null);
  const [role, setRole] = React.useState<string | null>(null);

  // Fetch cart count (sum of quantities)
  const loadCartCount = React.useCallback(async () => {
    try {
      const res = await fetch("/api/cart", { cache: "no-store" });
      // When signed out, our API returns { items: [] }
      const data = await res.json().catch(() => ({ items: [] as Array<{ quantity?: number }> }));
      const items: Array<{ quantity?: number }> = data?.items ?? [];
      const total = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
      setCartCount(total);
    } catch {
      // If it fails (e.g., not signed in), show 0
      setCartCount(0);
    }
  }, []);

  // Fetch user role (for admin link)
  const loadRole = React.useCallback(async () => {
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      const data = await res.json().catch(() => ({ role: null }));
      setRole(data?.role ?? null);
    } catch {
      setRole(null);
    }
  }, []);

  // Load on mount + when URL changes (navigate/search)
  React.useEffect(() => {
    loadCartCount();
    loadRole();
    // Listen for manual refresh events from the app (optional)
    const onUpdated = () => loadCartCount();
    window.addEventListener("cart:updated", onUpdated);
    return () => window.removeEventListener("cart:updated", onUpdated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]); // re-run on page/nav changes

  return (
    <header className="border-b bg-white">
      <nav className="mx-auto max-w-6xl p-4 flex items-center gap-4">
        {/* Left: logo */}
        <Link href="/" className="font-semibold text-neutral-900">
          Grainline
        </Link>

        {/* Middle: search (Home + Browse) */}
        {showSearch && <SearchBar />}

        {/* Right: links / auth */}
        <div className="ml-auto flex items-center gap-4">
          <Link href="/browse" className="text-neutral-800">
            Browse
          </Link>
          <Link href="/blog" className="text-neutral-800">
            Blog
          </Link>

          {/* Notifications */}
          <Show when="signed-in">
            <NotificationBell initialUnreadCount={0} />
          </Show>

          {/* Messages entry */}
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

          {/* Cart */}
          <Show
            when="signed-in"
            fallback={
              <Link
                href="/sign-in?redirect_url=/cart"
                className="relative inline-flex items-center gap-1 text-neutral-800"
                aria-label="Cart (sign in)"
                title="Cart"
              >
                <ShoppingBag size={20} />
                <span className="text-sm">Cart</span>
              </Link>
            }
          >
            <Link
              href="/cart"
              className="relative inline-flex items-center gap-1 text-neutral-800"
              aria-label="Cart"
              title="Cart"
            >
              <ShoppingBag size={20} />
              <span className="text-sm">Cart</span>
              {cartCount != null && cartCount > 0 && (
                <span className="absolute -right-2 -top-2 min-w-[18px] rounded-full bg-red-600 px-1.5 text-[11px] font-medium leading-5 text-white text-center">
                  {cartCount}
                </span>
              )}
            </Link>
          </Show>

          {/* Auth */}
          <Show
            when="signed-in"
            fallback={
              <Link href="/sign-in" className="text-neutral-800">
                Sign in
              </Link>
            }
          >
            {(role === "EMPLOYEE" || role === "ADMIN") && (
              <Link href="/admin" className="text-neutral-800">
                Admin
              </Link>
            )}
            <Link href="/dashboard" className="text-neutral-800">
              Dashboard
            </Link>
            <UserButton />
          </Show>
        </div>
      </nav>
    </header>
  );
}







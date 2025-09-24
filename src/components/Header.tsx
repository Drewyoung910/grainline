// src/components/Header.tsx
"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export default function Header() {
  return (
    <header className="border-b">
      <nav className="mx-auto max-w-5xl p-4 flex items-center justify-between">
        <Link href="/" className="font-semibold">Grainline</Link>
        <div className="flex items-center gap-4">
          <Link href="/browse">Browse</Link>
          <SignedOut>
            <Link href="/sign-in">Sign in</Link>
          </SignedOut>
          <SignedIn>
            <Link href="/dashboard/profile">Profile</Link>
            <Link href="/dashboard">Dashboard</Link>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>
      </nav>
    </header>
  );
}


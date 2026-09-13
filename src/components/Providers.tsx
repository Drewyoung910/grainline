"use client";
import { ClerkProvider } from "@clerk/nextjs";
import { ToastProvider } from "@/components/Toast";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import RecentlyViewedAuthBoundary from "@/components/RecentlyViewedAuthBoundary";

function resolveClerkPublishableKey() {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (key && key.trim()) return key;

  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY env var is required in production.");
  }

  return "";
}

const CLERK_PUBLISHABLE_KEY = resolveClerkPublishableKey();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignOutUrl="/"
    >
      <ToastProvider>
        <ServiceWorkerRegister />
        <RecentlyViewedAuthBoundary />
        {children}
      </ToastProvider>
    </ClerkProvider>
  );
}

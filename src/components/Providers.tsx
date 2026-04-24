"use client";
import { ClerkProvider } from "@clerk/nextjs";
import { ToastProvider } from "@/components/Toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!} afterSignOutUrl="/">
      <ToastProvider>
        {children}
      </ToastProvider>
    </ClerkProvider>
  );
}


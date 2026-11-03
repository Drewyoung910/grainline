// src/app/commission/new/page.tsx
"use client";

import { useRouter } from "next/navigation";
import CommissionRequestForm from "@/components/CommissionRequestForm";

// Direct links and signed-out visitors land here. Signed-in visitors usually
// post from the dialog on the Commission Room or homepage.
export default function NewCommissionPage() {
  const router = useRouter();
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-neutral-900">Post a Commission Request</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Describe the custom piece you&apos;re looking for. Interested makers will reach out to discuss.
        </p>
      </div>

      <CommissionRequestForm onPosted={() => router.push("/commission")} onCancel={() => {
          // A tab opened straight onto this page has nowhere to go back to.
          if (window.history.length > 1) router.back();
          else router.push("/commission");
        }} />
    </main>
  );
}

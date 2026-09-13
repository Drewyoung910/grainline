"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

interface Props {
  sellerProfileId: string;
  isFeatured: boolean;
  featureAction: (id: string) => Promise<void>;
  unfeatureAction: (id: string) => Promise<void>;
}

export function FeatureMakerButton({ sellerProfileId, isFeatured, featureAction, unfeatureAction }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function handleFeature(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await featureAction(sellerProfileId);
      router.refresh();
    } catch {
      toast("Could not feature this maker. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnfeature(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await unfeatureAction(sellerProfileId);
      router.refresh();
    } catch {
      toast("Could not unfeature this maker. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  if (isFeatured) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-xs text-green-700 font-medium">Featured ✓</span>
        <form onSubmit={handleUnfeature}>
          <button
            type="submit"
            disabled={loading}
            className="rounded border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
          >
            {loading ? "…" : "Unfeature"}
          </button>
        </form>
      </span>
    );
  }

  return (
    <form onSubmit={handleFeature}>
      <button
        type="submit"
        disabled={loading}
        className="rounded border border-amber-300 px-3 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
      >
        {loading ? "…" : "Feature →"}
      </button>
    </form>
  );
}

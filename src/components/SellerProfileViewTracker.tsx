"use client";

import { useEffect } from "react";

export default function SellerProfileViewTracker({ sellerId }: { sellerId: string }) {
  useEffect(() => {
    fetch(`/api/seller/${sellerId}/view`, { method: "POST" }).catch(() => {});
  }, [sellerId]);

  return null;
}

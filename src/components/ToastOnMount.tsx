"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

type ToastOnMountProps = {
  message: string;
  type?: "success" | "error" | "info";
  clearParam?: string;
};

export default function ToastOnMount({
  message,
  type = "info",
  clearParam,
}: ToastOnMountProps) {
  const { toast } = useToast();
  const router = useRouter();
  const shownRef = useRef(false);

  useEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    toast(message, type);
    if (!clearParam) return;

    const url = new URL(window.location.href);
    url.searchParams.delete(clearParam);
    const query = url.searchParams.toString();
    router.replace(query ? `${url.pathname}?${query}` : url.pathname, { scroll: false });
  }, [clearParam, message, router, toast, type]);

  return null;
}

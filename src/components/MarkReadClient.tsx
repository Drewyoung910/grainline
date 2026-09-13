"use client";

import { useEffect } from "react";

export default function MarkReadClient({ id }: { id: string }) {
  useEffect(() => {
    fetch(`/api/messages/${id}/read`, { method: "POST" }).catch(() => {});
  }, [id]);

  return null;
}

"use client";

import { useState, useEffect } from "react";

export default function LocalDate({ date }: { date: string | Date }) {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    setFormatted(new Date(date).toLocaleString());
  }, [date]);

  // SSR: render nothing; client: render local time. No hydration mismatch.
  if (!formatted) return <span suppressHydrationWarning>{new Date(date).toISOString().split("T")[0]}</span>;
  return <>{formatted}</>;
}

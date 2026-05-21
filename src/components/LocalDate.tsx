"use client";

import { useState, useEffect } from "react";

export default function LocalDate({ date, dateOnly = false }: { date: string | Date; dateOnly?: boolean }) {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    const parsed = new Date(date);
    setFormatted(
      dateOnly
        ? parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
        : parsed.toLocaleString("en-US"),
    );
  }, [date, dateOnly]);

  // SSR: render nothing; client: render local time. No hydration mismatch.
  if (!formatted) return <span suppressHydrationWarning>{new Date(date).toISOString().split("T")[0]}</span>;
  return <>{formatted}</>;
}

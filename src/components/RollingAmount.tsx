"use client";

import RollingText from "@/components/RollingText";
import { formatCurrencyCents } from "@/lib/money";

// A money amount that rolls to its new value (see RollingText): the listing
// price, cart line totals, subtotals, shipping and the estimated total.
export default function RollingAmount({
  cents,
  currency,
  className = "",
}: {
  cents: number;
  currency: string | null | undefined;
  className?: string;
}) {
  return <RollingText value={cents} text={formatCurrencyCents(cents, currency)} className={className} />;
}

"use client";

import * as React from "react";
import Link from "next/link";
import RollingAmount from "@/components/RollingAmount";
import RollingNumber from "@/components/RollingNumber";
import SegmentedControl from "@/components/SegmentedControl";
import { ArrowRight } from "@/components/icons";
import { DEFAULT_CURRENCY } from "@/lib/money";

type Range = "last7" | "last30" | "alltime";
const RANGES: ReadonlyArray<{ value: Range; label: string }> = [
  { value: "last7", label: "7 days" },
  { value: "last30", label: "30 days" },
  { value: "alltime", label: "All time" },
];

type Stats = { revenueCents: number; orders: number; views: number; saves: number };

function parseStats(data: unknown): Stats | null {
  const body = data as {
    overview?: { totalRevenueCents?: unknown; totalOrders?: unknown };
    engagement?: { totalViews?: unknown; favoritesCount?: unknown };
  } | null;
  const values = [
    body?.overview?.totalRevenueCents,
    body?.overview?.totalOrders,
    body?.engagement?.totalViews,
    body?.engagement?.favoritesCount,
  ];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const [revenueCents, orders, views, saves] = values as number[];
  return { revenueCents, orders, views, saves };
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card-section min-w-0 px-4 py-3.5 sm:px-[18px] sm:py-4">
      <p className="text-[13.5px] text-neutral-500">{label}</p>
      <div className="mt-1 min-h-9 text-2xl font-medium tabular-nums tracking-[-0.015em] text-neutral-900 sm:text-[30px] sm:leading-9">
        {children}
      </div>
    </div>
  );
}

// The numbers for a chosen range. Each card keeps its size while loading and
// rolls to the new value, so switching ranges never moves the page.
export default function WorkshopStats() {
  const [range, setRange] = React.useState<Range>("last30");
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "hidden" | "error">("loading");
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/seller/analytics?range=${range}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        // Shops still in setup have nothing to report yet.
        if (res.status === 409 || res.status === 404) {
          setState("hidden");
          return;
        }
        if (!res.ok) throw new Error(`Analytics failed (${res.status})`);
        const parsed = parseStats(await res.json());
        if (!parsed) throw new Error("Analytics response was not usable");
        setStats(parsed);
        setState("ready");
      } catch {
        if (controller.signal.aborted) return;
        setState("error");
      }
    })();
    return () => controller.abort();
  }, [range, attempt]);

  if (state === "hidden") return null;
  const placeholder = <span aria-hidden="true" className="inline-block h-7 w-16 animate-pulse rounded bg-[#EFEAE0] align-middle motion-reduce:animate-none" />;

  return (
    <section aria-labelledby="workshop-stats-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="workshop-stats-title" className="font-display text-[26px] leading-tight">How it&apos;s going</h2>
        <SegmentedControl
          label="Date range"
          size="sm"
          value={range}
          onChange={(value) => setRange(value as Range)}
          options={RANGES.map(({ value, label }) => ({ value, label }))}
        />
      </div>
      {state === "error" ? (
        <div className="card-section flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-sm text-neutral-600" role="status">
          These numbers didn&apos;t load.
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setState("loading"); setAttempt((value) => value + 1); }}>
            Try again
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-busy={state === "loading"}>
          <StatCard label="Revenue">
            {stats ? <RollingAmount cents={stats.revenueCents} currency={DEFAULT_CURRENCY} /> : placeholder}
          </StatCard>
          <StatCard label="Orders">{stats ? <RollingNumber value={stats.orders} /> : placeholder}</StatCard>
          <StatCard label="Listing views">{stats ? <RollingNumber value={stats.views} /> : placeholder}</StatCard>
          <StatCard label="New saves">{stats ? <RollingNumber value={stats.saves} /> : placeholder}</StatCard>
        </div>
      )}
      <Link href="/dashboard/analytics" className="group mt-3 inline-flex items-center gap-1 text-sm font-medium text-neutral-800 underline-offset-4 hover:underline">
        Full analytics
        <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none" />
      </Link>
    </section>
  );
}

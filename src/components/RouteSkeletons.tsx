import type { ReactNode } from "react";

export function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

function Shell({
  children,
  max = "max-w-7xl",
  label = "Loading",
}: {
  children: ReactNode;
  max?: string;
  label?: string;
}) {
  return (
    <main className={`mx-auto ${max} p-6 md:p-8`} aria-busy="true" aria-label={label}>
      {children}
    </main>
  );
}

function PageHeader({
  title = "h-8 w-56",
  subtitle = "h-4 w-80",
  action,
}: {
  title?: string;
  subtitle?: string;
  action?: string;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-3">
        <Pulse className={title} />
        <Pulse className={`${subtitle} max-w-full`} />
      </div>
      {action ? <Pulse className={action} /> : null}
    </header>
  );
}

export function AccountOverviewSkeleton() {
  return (
    <Shell label="Loading account">
      <header className="mb-10 flex items-center gap-4">
        <Pulse className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Pulse className="h-8 w-44" />
          <Pulse className="h-4 w-64 max-w-full" />
        </div>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-8">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <Pulse className="h-6 w-28" />
              <Pulse className="h-4 w-24" />
            </div>
            <OrderCardListSkeleton count={3} />
          </section>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <Pulse className="h-6 w-32" />
              <Pulse className="h-4 w-24" />
            </div>
            <ListingGridSkeleton count={4} />
          </section>
        </div>
        <aside className="space-y-4">
          <PanelListSkeleton rows={4} />
          <PanelListSkeleton rows={3} />
        </aside>
      </div>
    </Shell>
  );
}

export function WorkshopSkeleton() {
  return (
    <Shell label="Loading workshop">
      <PageHeader title="h-8 w-40" subtitle="h-4 w-72" action="h-10 w-32" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <section key={index} className="card-section p-4">
            <Pulse className="mb-3 h-5 w-5 rounded-full" />
            <Pulse className="h-7 w-16" />
            <Pulse className="mt-2 h-3 w-24" />
          </section>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-3">
          <Pulse className="h-6 w-28" />
          <InventoryListSkeleton rows={4} />
        </section>
        <aside className="space-y-4">
          <PanelListSkeleton rows={4} />
          <PanelListSkeleton rows={3} />
        </aside>
      </div>
    </Shell>
  );
}

export function CommissionRoomSkeleton() {
  return (
    <Shell label="Loading commission room">
      <PageHeader title="h-9 w-72" subtitle="h-4 w-[30rem]" action="h-10 w-40" />
      <div className="mb-6 flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }).map((_, index) => (
          <Pulse key={index} className="h-9 w-28 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <section key={index} className="card-section p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <Pulse className="h-5 w-48 max-w-full" />
              <Pulse className="h-5 w-20 rounded-full" />
            </div>
            <Pulse className="mb-2 h-4 w-full" />
            <Pulse className="mb-4 h-4 w-3/4" />
            <div className="flex gap-2">
              <Pulse className="h-8 w-24" />
              <Pulse className="h-8 w-28" />
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}

export function SavedItemsSkeleton() {
  return (
    <Shell label="Loading saved items">
      <Pulse className="mb-4 h-4 w-36" />
      <PageHeader title="h-8 w-32" subtitle="h-4 w-64" />
      <div className="mb-6 flex gap-2">
        <Pulse className="h-9 w-28 rounded-full" />
        <Pulse className="h-9 w-24 rounded-full" />
      </div>
      <ListingGridSkeleton count={8} />
    </Shell>
  );
}

export function OrdersSkeleton({ label = "Loading orders" }: { label?: string }) {
  return (
    <Shell label={label}>
      <Pulse className="mb-4 h-4 w-24" />
      <PageHeader title="h-8 w-36" subtitle="h-4 w-72" />
      <OrderCardListSkeleton count={4} />
    </Shell>
  );
}

export function SalesSkeleton() {
  return (
    <Shell label="Loading sales">
      <PageHeader title="h-8 w-28" subtitle="h-4 w-72" />
      <OrderCardListSkeleton count={5} includeActions />
    </Shell>
  );
}

export function InventorySkeleton() {
  return (
    <Shell label="Loading inventory">
      <PageHeader title="h-8 w-32" subtitle="h-4 w-80" action="h-10 w-28" />
      <div className="space-y-8">
        <section className="space-y-3">
          <Pulse className="h-6 w-24" />
          <InventoryListSkeleton rows={5} />
        </section>
        <section className="space-y-3">
          <Pulse className="h-6 w-32" />
          <InventoryListSkeleton rows={2} />
        </section>
      </div>
    </Shell>
  );
}

export function BlogManagerSkeleton() {
  return (
    <Shell label="Loading blog posts">
      <PageHeader title="h-8 w-44" subtitle="h-4 w-40" action="h-10 w-28" />
      <ul className="card-section divide-y divide-neutral-100">
        {Array.from({ length: 6 }).map((_, index) => (
          <li key={index} className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex gap-2">
                <Pulse className="h-5 w-20 rounded-full" />
                <Pulse className="h-5 w-20 rounded-full" />
              </div>
              <Pulse className="h-4 w-72 max-w-full" />
              <Pulse className="h-3 w-44 max-w-full" />
            </div>
            <div className="hidden gap-2 sm:flex">
              <Pulse className="h-8 w-16" />
              <Pulse className="h-8 w-16" />
              <Pulse className="h-8 w-20" />
            </div>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

export function FormPageSkeleton({
  label,
  title = "h-8 w-56",
  subtitle = "h-4 w-80",
  sections = 4,
}: {
  label: string;
  title?: string;
  subtitle?: string;
  sections?: number;
}) {
  return (
    <Shell label={label} max="max-w-5xl">
      <PageHeader title={title} subtitle={subtitle} />
      <div className="space-y-5">
        {Array.from({ length: sections }).map((_, section) => (
          <section key={section} className="card-section p-5">
            <Pulse className="mb-5 h-6 w-44" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Pulse className="h-10 w-full" />
              <Pulse className="h-10 w-full" />
              <Pulse className="h-24 w-full sm:col-span-2" />
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}

export function SettingsSkeleton() {
  return (
    <Shell label="Loading settings" max="max-w-3xl">
      <Pulse className="mb-4 h-4 w-24" />
      <PageHeader title="h-8 w-48" subtitle="h-4 w-72" />
      <div className="space-y-4">
        <PanelListSkeleton rows={4} />
        <PanelListSkeleton rows={5} />
      </div>
    </Shell>
  );
}

export function VerificationSkeleton() {
  return (
    <Shell label="Loading guild application">
      <PageHeader title="h-8 w-64" subtitle="h-4 w-[28rem]" />
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <section key={index} className="card-section p-5">
            <Pulse className="mb-4 h-10 w-10 rounded-full" />
            <Pulse className="mb-3 h-5 w-36" />
            <Pulse className="mb-2 h-4 w-full" />
            <Pulse className="h-4 w-3/4" />
          </section>
        ))}
      </div>
      <section className="card-section mt-6 p-5">
        <Pulse className="mb-5 h-6 w-44" />
        <div className="space-y-4">
          <Pulse className="h-24 w-full" />
          <Pulse className="h-10 w-full" />
          <Pulse className="h-10 w-40" />
        </div>
      </section>
    </Shell>
  );
}

export function AnalyticsSkeleton() {
  return (
    <Shell label="Loading analytics">
      <PageHeader title="h-8 w-32" subtitle="h-4 w-72" />
      <div className="mb-6 flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, index) => (
          <Pulse key={index} className="h-9 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <section key={index} className="card-section p-4">
            <Pulse className="mb-4 h-4 w-24" />
            <Pulse className="h-8 w-20" />
            <Pulse className="mt-2 h-3 w-28" />
          </section>
        ))}
      </div>
      <section className="card-section mt-6 p-5">
        <Pulse className="mb-4 h-6 w-48" />
        <Pulse className="h-72 w-full" />
      </section>
    </Shell>
  );
}

export function SimpleListPageSkeleton({
  label,
  title,
  rows = 5,
}: {
  label: string;
  title: string;
  rows?: number;
}) {
  return (
    <Shell label={label} max="max-w-4xl">
      <Pulse className="mb-4 h-4 w-24" />
      <PageHeader title={title} subtitle="h-4 w-72" />
      <PanelListSkeleton rows={rows} />
    </Shell>
  );
}

function ListingGridSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <section key={index} className="card-section overflow-hidden">
          <Pulse className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-2 p-3">
            <Pulse className="h-4 w-3/4" />
            <Pulse className="h-3 w-1/2" />
          </div>
        </section>
      ))}
    </div>
  );
}

function InventoryListSkeleton({ rows }: { rows: number }) {
  return (
    <ul className="card-section divide-y divide-neutral-100">
      {Array.from({ length: rows }).map((_, index) => (
        <li key={index} className="flex items-center gap-4 px-4 py-3">
          <Pulse className="h-14 w-14 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Pulse className="h-4 w-56 max-w-full" />
            <Pulse className="h-3 w-36 max-w-full" />
          </div>
          <Pulse className="hidden h-9 w-24 sm:block" />
        </li>
      ))}
    </ul>
  );
}

function OrderCardListSkeleton({
  count,
  includeActions = false,
}: {
  count: number;
  includeActions?: boolean;
}) {
  return (
    <ul className="space-y-4">
      {Array.from({ length: count }).map((_, index) => (
        <li key={index} className="card-section overflow-hidden">
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
            <Pulse className="h-4 w-32" />
            <Pulse className="h-5 w-24 rounded-full" />
          </div>
          <div className="flex items-center gap-3 px-4 py-4">
            <Pulse className="h-14 w-14 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Pulse className="h-4 w-64 max-w-full" />
              <Pulse className="h-3 w-40 max-w-full" />
            </div>
            {includeActions ? <Pulse className="hidden h-9 w-24 sm:block" /> : null}
          </div>
          <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-3">
            <Pulse className="h-4 w-28" />
            <Pulse className="h-8 w-24" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function PanelListSkeleton({ rows }: { rows: number }) {
  return (
    <section className="card-section divide-y divide-neutral-100">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3">
          <Pulse className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Pulse className="h-4 w-48 max-w-full" />
            <Pulse className="h-3 w-32 max-w-full" />
          </div>
          <Pulse className="hidden h-8 w-20 sm:block" />
        </div>
      ))}
    </section>
  );
}

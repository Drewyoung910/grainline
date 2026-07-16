function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
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
          <Pulse className="h-9 w-24" />
        </li>
      ))}
    </ul>
  );
}

export default function InventoryLoading() {
  return (
    <main className="mx-auto max-w-7xl space-y-8 p-8" aria-busy="true" aria-label="Loading inventory">
      <header className="space-y-3">
        <Pulse className="h-7 w-32" />
        <Pulse className="h-4 w-80 max-w-full" />
      </header>
      <section className="space-y-3">
        <Pulse className="h-5 w-24" />
        <InventoryListSkeleton rows={5} />
      </section>
      <section className="space-y-3">
        <Pulse className="h-5 w-32" />
        <InventoryListSkeleton rows={2} />
      </section>
    </main>
  );
}

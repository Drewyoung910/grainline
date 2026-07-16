function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

export default function AccountOrdersLoading() {
  return (
    <main className="mx-auto max-w-7xl p-6 md:p-8" aria-busy="true" aria-label="Loading orders">
      <div className="mb-6 flex items-center gap-4">
        <Pulse className="h-4 w-24" />
        <Pulse className="h-8 w-32" />
      </div>
      <ul className="space-y-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <li key={index} className="card-section overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <Pulse className="h-4 w-32" />
              <Pulse className="h-5 w-24 rounded-full" />
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <Pulse className="h-12 w-12 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Pulse className="h-4 w-64 max-w-full" />
                <Pulse className="h-3 w-36 max-w-full" />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-3">
              <Pulse className="h-4 w-28" />
              <Pulse className="h-8 w-24" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

export default function SavedLoading() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8" aria-busy="true" aria-label="Loading saved items">
      <Pulse className="mb-4 h-4 w-36" />
      <Pulse className="mb-6 h-7 w-24" />
      <div className="mb-6 flex gap-2">
        <Pulse className="h-9 w-28 rounded-full" />
        <Pulse className="h-9 w-24 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <section key={index} className="card-section overflow-hidden">
            <Pulse className="aspect-[4/3] w-full rounded-none" />
            <div className="space-y-2 p-3">
              <Pulse className="h-4 w-3/4" />
              <Pulse className="h-3 w-1/2" />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

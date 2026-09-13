function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

export default function SavedSearchesLoading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6" aria-busy="true" aria-label="Loading saved searches">
      <Pulse className="mb-4 h-4 w-28" />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <Pulse className="h-8 w-52" />
          <Pulse className="h-4 w-72 max-w-full" />
        </div>
        <Pulse className="h-10 w-32" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <section key={index} className="card-section p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <Pulse className="h-4 w-72 max-w-full" />
                <Pulse className="h-3 w-28" />
              </div>
              <div className="flex gap-2">
                <Pulse className="h-9 w-20" />
                <Pulse className="h-9 w-20" />
              </div>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

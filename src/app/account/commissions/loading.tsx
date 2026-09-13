function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

export default function AccountCommissionsLoading() {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6" aria-busy="true" aria-label="Loading commission requests">
      <Pulse className="mb-4 h-4 w-24" />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <Pulse className="h-8 w-72 max-w-full" />
          <Pulse className="h-4 w-80 max-w-full" />
        </div>
        <Pulse className="h-10 w-32" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <section key={index} className="card-section p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <Pulse className="h-5 w-64 max-w-full" />
              <Pulse className="h-5 w-20 rounded-full" />
            </div>
            <Pulse className="mb-3 h-4 w-full" />
            <Pulse className="h-4 w-2/3" />
          </section>
        ))}
      </div>
    </main>
  );
}

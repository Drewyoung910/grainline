function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

export default function FollowingLoading() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8" aria-busy="true" aria-label="Loading followed makers">
      <Pulse className="mb-4 h-4 w-24" />
      <div className="mb-6 flex items-center justify-between gap-4">
        <Pulse className="h-7 w-52" />
        <Pulse className="h-10 w-28 shrink-0" />
      </div>
      <ul className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <li key={index} className="card-section flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
            <div className="flex min-w-0 flex-1 gap-3">
              <Pulse className="h-14 w-14 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Pulse className="h-4 w-40 max-w-full" />
                <Pulse className="h-3 w-72 max-w-full" />
                <Pulse className="h-3 w-64 max-w-full" />
                <div className="flex items-center gap-2 pt-1">
                  <Pulse className="h-10 w-10 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Pulse className="h-3 w-44 max-w-full" />
                    <Pulse className="h-3 w-16" />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 justify-end sm:pt-1">
              <Pulse className="h-9 w-24" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

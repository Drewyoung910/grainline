function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

export default function SavedLoading() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8" aria-busy="true" aria-label="Loading saved items">
      <Pulse className="mb-4 h-4 w-36" />
      <Pulse className="mb-6 h-7 w-24" />
      <div className="mb-6 flex gap-1 border-b border-neutral-100">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="flex h-10 w-28 items-center px-4">
            <Pulse className="h-4 w-full" />
          </div>
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <li key={index}>
            <Pulse className="aspect-[4/5] w-full rounded-2xl" />
            <div className="space-y-2 pt-2.5">
              <Pulse className="h-4 w-4/5" />
              <Pulse className="h-4 w-1/3" />
              <Pulse className="h-3 w-2/3" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

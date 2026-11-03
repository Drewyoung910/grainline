function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] motion-reduce:animate-none ${className}`} />;
}

export default function Loading() {
  return (
    <main className="mx-auto max-w-5xl space-y-5" aria-busy="true" aria-label="Loading listings">
      <div>
        <Pulse className="h-11 w-44" />
        <Pulse className="mt-3 h-4 w-64 max-w-full" />
      </div>
      <Pulse className="h-9 w-80 max-w-full rounded-full" />
      <ul className="card-section divide-y divide-neutral-100">
        {Array.from({ length: 5 }).map((_, index) => (
          <li key={index} className="flex gap-3.5 p-4">
            <Pulse className="h-[90px] w-[72px] shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-3">
              <Pulse className="h-4 w-2/3" />
              <Pulse className="h-3 w-1/2" />
              <Pulse className="h-8 w-48 max-w-full rounded-md" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

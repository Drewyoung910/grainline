function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

export default function NotificationsLoading() {
  return (
    <main className="mx-auto max-w-2xl p-8" aria-busy="true" aria-label="Loading notifications">
      <div className="mb-6 flex items-center justify-between">
        <div className="space-y-3">
          <Pulse className="h-7 w-40" />
          <Pulse className="h-4 w-20" />
        </div>
        <Pulse className="h-5 w-28" />
      </div>
      <ul className="card-section divide-y divide-neutral-100 overflow-hidden">
        {Array.from({ length: 7 }).map((_, index) => (
          <li key={index} className="flex items-start gap-4 px-5 py-4">
            <Pulse className="mt-0.5 h-5 w-5 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Pulse className="h-4 w-52 max-w-full" />
              <Pulse className="h-3 w-full" />
              <Pulse className="h-3 w-24" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

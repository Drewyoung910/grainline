function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

export default function BlockedUsersLoading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6" aria-busy="true" aria-label="Loading blocked users">
      <div className="mb-6 space-y-2">
        <Pulse className="h-4 w-24" />
        <Pulse className="h-7 w-40" />
        <Pulse className="h-4 w-28" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="card-section flex items-center gap-4 p-4">
            <Pulse className="h-10 w-10 shrink-0 rounded-full" />
            <Pulse className="h-4 w-40 max-w-full flex-1" />
            <Pulse className="h-9 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </main>
  );
}

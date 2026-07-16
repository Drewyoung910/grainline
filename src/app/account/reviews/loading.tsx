function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

export default function MyReviewsLoading() {
  return (
    <main
      className="mx-auto max-w-3xl px-4 py-12 sm:px-6"
      aria-busy="true"
      aria-label="Loading reviews"
    >
      <div className="mb-6">
        <Pulse className="h-4 w-24" />
        <Pulse className="mt-3 h-8 w-36" />
        <Pulse className="mt-2 h-4 w-20" />
      </div>

      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="card-section flex gap-4 p-4">
            <Pulse className="h-16 w-16 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Pulse className={`h-4 max-w-full ${index === 1 ? "w-52" : "w-64"}`} />
              <div className="flex items-center gap-2">
                <Pulse className="h-4 w-24" />
                <Pulse className="h-3 w-20" />
              </div>
              <Pulse className="h-3 w-full" />
              <Pulse className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

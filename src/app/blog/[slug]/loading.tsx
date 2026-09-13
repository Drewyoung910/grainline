function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

export default function BlogPostLoading() {
  return (
    <main
      className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 pt-8"
      aria-busy="true"
      aria-label="Loading post"
    >
      {/* Breadcrumb */}
      <Pulse className="mb-6 h-4 w-40" />

      {/* Type badge + meta */}
      <div className="mb-4 flex items-center gap-3">
        <Pulse className="h-5 w-24 rounded-full" />
        <Pulse className="h-3 w-16" />
        <Pulse className="h-3 w-24" />
      </div>

      {/* Title */}
      <div className="mb-6 space-y-2">
        <Pulse className="h-9 w-full" />
        <Pulse className="h-9 w-2/3" />
      </div>

      {/* Author card */}
      <div className="mb-8 flex items-center gap-3 border-b border-neutral-100 pb-6">
        <Pulse className="h-10 w-10 rounded-full" />
        <div className="space-y-1.5">
          <Pulse className="h-4 w-32" />
          <Pulse className="h-3 w-24" />
        </div>
      </div>

      {/* Cover image */}
      <Pulse className="mb-8 h-64 w-full rounded-2xl sm:h-96" />

      {/* Body */}
      <div className="space-y-3">
        <Pulse className="h-4 w-full" />
        <Pulse className="h-4 w-full" />
        <Pulse className="h-4 w-5/6" />
        <Pulse className="h-4 w-full" />
        <Pulse className="h-4 w-3/4" />
        <div className="pt-4" />
        <Pulse className="h-4 w-full" />
        <Pulse className="h-4 w-11/12" />
        <Pulse className="h-4 w-2/3" />
      </div>
    </main>
  );
}

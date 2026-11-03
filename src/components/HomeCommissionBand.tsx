import Link from "next/link";
import CommissionPostButton from "@/components/CommissionPostButton";

export default function HomeCommissionBand() {
  return (
    <section
      data-home-commission
      aria-labelledby="home-commission-title"
      className="bg-[#2C1F1A] text-[#F5EFE6]"
    >
      <div className="mx-auto grid max-w-[1600px] items-center gap-6 px-4 py-10 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-8 lg:px-8">
        <div className="min-w-0">
          <h2
            id="home-commission-title"
            className="font-display text-[clamp(1.75rem,3.4vw,2.625rem)] leading-[1.08]"
          >
            Have something specific in mind?
          </h2>
          <p className="mt-2.5 max-w-[54ch] text-sm leading-relaxed text-[#F5EFE6]/80 sm:text-base">
            Post a request with the size, materials, and budget. Interested makers can respond, and you decide who to continue with.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:gap-3 lg:justify-end">
          <CommissionPostButton
            className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full bg-[#F5EFE6] px-4 text-center text-sm font-semibold text-[#2C1F1A] transition-[background-color,scale] hover:bg-white motion-safe:active:scale-[0.97] sm:min-h-[46px] sm:px-6"
          >
            Post a request
          </CommissionPostButton>
          <Link
            href="/commission"
            className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border border-[#F5EFE6]/40 px-4 text-center text-sm font-semibold text-[#F5EFE6] transition-[background-color,border-color,scale] hover:border-[#F5EFE6]/60 hover:bg-white/10 motion-safe:active:scale-[0.97] sm:min-h-[46px] sm:px-6"
          >
            Browse requests
          </Link>
        </div>
      </div>
    </section>
  );
}

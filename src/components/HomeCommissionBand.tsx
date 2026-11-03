import Link from "next/link";
import CommissionPostButton from "@/components/CommissionPostButton";

export default function HomeCommissionBand() {
  return (
    <section
      data-home-commission
      aria-labelledby="home-commission-title"
      className="bg-[#2C1F1A] text-[#F5EFE6]"
    >
      <div className="mx-auto grid max-w-[1600px] items-center gap-6 px-4 py-12 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-8 lg:px-8">
        <div className="min-w-0">
          <h2 id="home-commission-title" className="font-display text-[clamp(1.75rem,3.4vw,2.625rem)] leading-[1.08]">
            Have something specific in mind?
          </h2>
          <p className="mt-2.5 max-w-[52ch] text-[#F5EFE6]/80">
            Post a commission with your size, wood and budget. Makers who can build it reach out, and you pick who to work with.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 lg:justify-end">
          <CommissionPostButton className="inline-flex min-h-[46px] items-center justify-center rounded-full bg-[#F5EFE6] px-6 text-sm font-semibold text-[#2C1F1A] transition-colors hover:bg-white">
            Post a commission
          </CommissionPostButton>
          <Link
            href="/commission"
            className="inline-flex min-h-[46px] items-center justify-center rounded-full border border-[#F5EFE6]/40 px-6 text-sm font-semibold text-[#F5EFE6] transition-colors hover:bg-white/10"
          >
            See open requests
          </Link>
        </div>
      </div>
    </section>
  );
}

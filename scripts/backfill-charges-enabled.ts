import { prisma } from '../src/lib/db'
import { stripe } from '../src/lib/stripe'

function assertNonProductionScript() {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
  const forceProd = process.argv.includes('--force-prod')
  if (isProduction && !forceProd) {
    throw new Error('Refusing to update production without --force-prod.')
  }
}

async function main() {
  assertNonProductionScript()
  let updated = 0
  let scanned = 0
  let cursor: string | null = null
  for (;;) {
    const sellers = await prisma.$queryRaw<Array<{
      id: string
      stripeAccountId: string
    }>>`
      SELECT id, "stripeAccountId"
        FROM public.grainline_seller_stripe_reconciliation_page(
          ${cursor}::text,
          200::integer
        )
    `
    if (sellers.length === 0) break
    for (const seller of sellers) {
      scanned += 1
      try {
        const account = await stripe.accounts.retrieve(seller.stripeAccountId)
        await prisma.$queryRaw`
          SELECT public.grainline_seller_stripe_charges_update(
            ${seller.id}::text,
            ${seller.stripeAccountId}::text,
            ${Boolean(account.charges_enabled)}::boolean
          )
        `
        updated += 1
      } catch (error) {
        console.error(`Failed to sync ${seller.id} (${seller.stripeAccountId}):`, error)
      }
    }
    cursor = sellers.at(-1)!.id
  }

  console.log(`Synced ${updated}/${scanned} seller profiles`)
  await prisma.$disconnect()
}

main().catch(console.error)

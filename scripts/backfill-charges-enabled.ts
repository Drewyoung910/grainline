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
  const sellers = await prisma.sellerProfile.findMany({
    where: { stripeAccountId: { not: null } },
    select: { id: true, stripeAccountId: true },
  })

  let updated = 0
  for (const seller of sellers) {
    if (!seller.stripeAccountId) continue
    try {
      const account = await stripe.accounts.retrieve(seller.stripeAccountId)
      await prisma.sellerProfile.update({
        where: { id: seller.id },
        data: { chargesEnabled: Boolean(account.charges_enabled) },
      })
      updated += 1
    } catch (error) {
      console.error(`Failed to sync ${seller.id} (${seller.stripeAccountId}):`, error)
    }
  }

  console.log(`Synced ${updated}/${sellers.length} seller profiles`)
  await prisma.$disconnect()
}

main().catch(console.error)

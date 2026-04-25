import { prisma } from '../src/lib/db'

function assertNonProductionScript() {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    throw new Error('Refusing to blindly enable charges in production.')
  }
}

async function main() {
  assertNonProductionScript()
  const result = await prisma.sellerProfile.updateMany({
    where: { stripeAccountId: { not: null } },
    data: { chargesEnabled: true },
  })
  console.log(`Updated ${result.count} seller profiles`)
  await prisma.$disconnect()
}

main().catch(console.error)

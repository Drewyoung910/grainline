import { prisma } from '../src/lib/db'

async function main() {
  const result = await prisma.sellerProfile.updateMany({
    where: { stripeAccountId: { not: null } },
    data: { chargesEnabled: true },
  })
  console.log(`Updated ${result.count} seller profiles`)
  await prisma.$disconnect()
}

main().catch(console.error)

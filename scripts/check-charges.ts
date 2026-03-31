import { prisma } from '../src/lib/db'

async function main() {
  const total = await prisma.sellerProfile.count()
  const enabled = await prisma.sellerProfile.count({ where: { chargesEnabled: true } })
  const withStripe = await prisma.sellerProfile.count({ where: { stripeAccountId: { not: null } } })
  console.log(`Total sellers: ${total}`)
  console.log(`chargesEnabled=true: ${enabled}`)
  console.log(`Has stripeAccountId: ${withStripe}`)

  const sellers = await prisma.sellerProfile.findMany({
    select: {
      id: true,
      displayName: true,
      chargesEnabled: true,
      stripeAccountId: true,
      vacationMode: true,
    }
  })
  console.table(sellers.map(s => ({
    name: s.displayName,
    chargesEnabled: s.chargesEnabled,
    hasStripe: !!s.stripeAccountId,
    onVacation: s.vacationMode,
  })))
  await prisma.$disconnect()
}
main().catch(console.error)

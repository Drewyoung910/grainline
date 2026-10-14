import { prisma } from '../src/lib/db'

async function main() {
  const total = await prisma.sellerProfile.count()
  const enabled = await prisma.sellerProfile.count({ where: { chargesEnabled: true } })
  const [{ count: withStripe }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT pg_catalog.count(*)::bigint AS count
      FROM public."SellerProfilePrivate"
     WHERE "stripeAccountId" IS NOT NULL
  `
  console.log(`Total sellers: ${total}`)
  console.log(`chargesEnabled=true: ${enabled}`)
  console.log(`Has stripeAccountId: ${withStripe}`)

  const sellers = await prisma.$queryRaw<Array<{
    displayName: string
    chargesEnabled: boolean
    vacationMode: boolean
    hasStripe: boolean
  }>>`
    SELECT seller."displayName",
           seller."chargesEnabled",
           seller."vacationMode",
           seller_private."stripeAccountId" IS NOT NULL AS "hasStripe"
      FROM public."SellerProfile" AS seller
      JOIN public."SellerProfilePrivate" AS seller_private
        ON seller_private."sellerProfileId" = seller.id
     ORDER BY seller.id
  `
  console.table(sellers.map(s => ({
    name: s.displayName,
    chargesEnabled: s.chargesEnabled,
    hasStripe: s.hasStripe,
    onVacation: s.vacationMode,
  })))
  await prisma.$disconnect()
}
main().catch(console.error)

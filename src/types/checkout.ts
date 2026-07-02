export type ShippingAddress = {
  name: string
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
  phone: string
}

export type SelectedShippingRate = {
  objectId: string
  amountCents: number
  currency: string
  displayName: string
  carrier: string
  estDays: number | null
  subjectHash: string
  token: string        // HMAC from signRate()
  expiresAt: number    // Unix timestamp seconds
}

export function isFallbackRate(rate: SelectedShippingRate): boolean {
  return rate.objectId === "fallback"
}

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
  displayName: string
  carrier: string
  estDays: number | null
  token: string        // HMAC from signRate()
  expiresAt: number    // Unix timestamp seconds
}

export const FALLBACK_RATE: SelectedShippingRate = {
  objectId: "fallback",
  amountCents: 0,
  displayName: "Calculated at checkout",
  carrier: "",
  estDays: null,
  token: "fallback",    // intentionally invalid HMAC
  expiresAt: 0,         // intentionally expired
}

export function isFallbackRate(rate: SelectedShippingRate): boolean {
  return rate.objectId === "fallback"
}

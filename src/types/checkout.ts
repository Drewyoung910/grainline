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
}

export const FALLBACK_RATE: SelectedShippingRate = {
  objectId: "fallback",
  amountCents: 0,
  displayName: "Calculated at checkout",
  carrier: "",
  estDays: null,
}

export function isFallbackRate(rate: SelectedShippingRate): boolean {
  return rate.objectId === "fallback"
}

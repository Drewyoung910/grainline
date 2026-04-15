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

// src/lib/packing.ts
export type PackSpec = {
  weightGrams: number
  lengthCm?: number | null
  widthCm?: number | null
  heightCm?: number | null
  shipsSeparately?: boolean
  qty: number
}

export type SellerDefaults = {
  defaultPkgLengthCm?: number | null
  defaultPkgWidthCm?: number | null
  defaultPkgHeightCm?: number | null
  defaultMaxParcelWeightGrams?: number | null
}

export type Parcel = {
  weight: { value: number; unit: "g" }
  length?: string
  width?: string
  height?: string
}

function dimsOrDefault(
  length?: number | null,
  width?: number | null,
  height?: number | null,
  d?: SellerDefaults
) {
  return {
    length: (length ?? d?.defaultPkgLengthCm ?? undefined),
    width:  (width  ?? d?.defaultPkgWidthCm  ?? undefined),
    height: (height ?? d?.defaultPkgHeightCm ?? undefined),
  };
}

/**
 * Very simple heuristic:
 * - Items with shipsSeparately => each unit is its own parcel
 * - Otherwise, bundle into a running parcel until max weight reached, using
 *   max L/W/H seen (or seller defaults when dims missing)
 */
export function buildParcels(
  specs: PackSpec[],
  defaults: SellerDefaults
): Parcel[] {
  const parcels: Parcel[] = [];
  const maxW = defaults.defaultMaxParcelWeightGrams ?? 0;

  const pushParcel = (w: number, L?: number, W?: number, H?: number) => {
    const p: Parcel = { weight: { value: w, unit: "g" } };
    if (L) p.length = String(L);
    if (W) p.width  = String(W);
    if (H) p.height = String(H);
    parcels.push(p);
  };

  for (const s of specs) {
    const { weightGrams, lengthCm, widthCm, heightCm, shipsSeparately, qty } = s;
    if (!weightGrams || weightGrams <= 0) continue;

    if (shipsSeparately) {
      const { length, width, height } = dimsOrDefault(lengthCm, widthCm, heightCm, defaults);
      for (let i = 0; i < qty; i++) pushParcel(weightGrams, length, width, height);
      continue;
    }

    let remaining = qty;
    let openWeight = 0;
    let L = 0, W = 0, H = 0;
    const d = dimsOrDefault(lengthCm, widthCm, heightCm, defaults);
    const addDims = () => {
      if (d.length && d.width && d.height) {
        L = Math.max(L, d.length);
        W = Math.max(W, d.width);
        H = Math.max(H, d.height);
      }
    };

    while (remaining > 0) {
      if (maxW > 0 && openWeight + weightGrams > maxW) {
        // close current parcel
        pushParcel(openWeight, L || d.length, W || d.width, H || d.height);
        openWeight = 0; L = 0; W = 0; H = 0;
      }
      openWeight += weightGrams;
      addDims();
      remaining--;
    }
    if (openWeight > 0) pushParcel(openWeight, L || d.length, W || d.width, H || d.height);
  }

  // If any parcel has no dims at all, that's ok—Shippo can still rate by weight.
  return parcels;
}


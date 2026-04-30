// src/lib/shippo.ts
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { readResponseTextWithTimeout } from "@/lib/responseText";

const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY!;
const SHIPPO_BASE = "https://api.goshippo.com";

type Address = {
  name?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string; // "US"
};

type Parcel = {
  weight: { value: number; unit: "g" };
  length?: string;
  width?: string;
  height?: string;
};

// Minimal generic wrapper (some routes import this)
export async function shippoRequest<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  if (!SHIPPO_API_KEY) throw new Error("Missing SHIPPO_API_KEY");
  const headers: Record<string, string> = {
    Authorization: `ShippoToken ${SHIPPO_API_KEY}`,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetchWithTimeout(`${SHIPPO_BASE}${path}`, { ...init, headers }, 15_000);
  if (!res.ok) {
    const text = await readResponseTextWithTimeout(res);
    throw new Error(`Shippo ${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

// Your existing multi-piece rating helper (kept as-is)
export async function shippoRatesMultiPiece(opts: {
  from: Address;
  to: Address;
  parcels: Parcel[];
}) {
  const { from, to, parcels } = opts;

  const shipment = {
    address_from: {
      name: from.name,
      street1: from.street1,
      street2: from.street2,
      city: from.city,
      state: from.state,
      zip: from.zip,
      country: from.country,
    },
    address_to: {
      name: to.name,
      street1: to.street1,
      street2: to.street2,
      city: to.city,
      state: to.state,
      zip: to.zip,
      country: to.country,
    },
    parcels: parcels.map((p) => ({
      weight: String(p.weight.value),
      mass_unit: "g",
      ...(p.length && { length: p.length }),
      ...(p.width && { width: p.width }),
      ...(p.height && { height: p.height }),
      distance_unit: "cm",
    })),
  };

  const res = await fetchWithTimeout(`${SHIPPO_BASE}/shipments/`, {
    method: "POST",
    headers: {
      Authorization: `ShippoToken ${SHIPPO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...shipment, async: false }),
  }, 20_000);

  if (!res.ok) {
    const t = await readResponseTextWithTimeout(res);
    throw new Error(`Shippo create shipment failed: ${res.status} ${t}`);
  }

  const shipmentObj = await res.json();
  type ShippoRate = { object_id?: string; provider?: string; servicelevel?: { name?: string }; amount?: string | number; currency?: string; est_days?: number };
  const rates = ((shipmentObj as { rates?: ShippoRate[] }).rates || []).map((r) => ({
    objectId: r.object_id,
    provider: r.provider,
    servicelevel_name: r.servicelevel?.name,
    amount: Math.round(Number(r.amount) * 100), // cents
    currency: r.currency || "USD",
    est_days: r.est_days,
  }));

  return { shipmentId: shipmentObj.object_id, rates };
}

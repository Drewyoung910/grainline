"use client";

import { useState, useEffect, useCallback } from "react";
import type { ShippingAddress } from "@/types/checkout";

export type { ShippingAddress };

const US_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
] as const;

const STATE_CODES = new Set(US_STATES.map((s) => s.code));

type Props = {
  onConfirm: (address: ShippingAddress) => void;
  onBack?: () => void;
  isSignedIn: boolean;
};

type FieldErrors = Partial<Record<keyof ShippingAddress, string>>;

export default function ShippingAddressForm({ onConfirm, onBack, isSignedIn }: Props) {
  const [name, setName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [phone, setPhone] = useState("");
  const [saveAddress, setSaveAddress] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(isSignedIn);
  const [saving, setSaving] = useState(false);

  const loadSavedAddress = useCallback(async () => {
    try {
      const res = await fetch("/api/account/shipping-address", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.name) setName(data.name);
      if (data.line1) setLine1(data.line1);
      if (data.line2) setLine2(data.line2);
      if (data.city) setCity(data.city);
      if (data.state) setState(data.state);
      if (data.postalCode) setPostalCode(data.postalCode);
      if (data.phone) setPhone(data.phone);
    } catch {
      // silent — form starts empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSignedIn) loadSavedAddress();
  }, [isSignedIn, loadSavedAddress]);

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!name.trim()) e.name = "Full name is required";
    if (!line1.trim()) e.line1 = "Address is required";
    if (!city.trim()) e.city = "City is required";
    if (!state || !STATE_CODES.has(state as typeof US_STATES[number]["code"])) e.state = "Select a state";
    if (!/^\d{5}$/.test(postalCode)) e.postalCode = "Enter a 5-digit ZIP code";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fieldErrors = validate();
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    const address: ShippingAddress = {
      name: name.trim(),
      line1: line1.trim(),
      line2: line2.trim(),
      city: city.trim(),
      state,
      postalCode,
      phone: phone.trim(),
    };

    if (isSignedIn && saveAddress) {
      setSaving(true);
      try {
        await fetch("/api/account/shipping-address", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(address),
        });
      } catch (err) {
        console.error("Failed to save shipping address:", err);
      } finally {
        setSaving(false);
      }
    }

    onConfirm(address);
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 bg-neutral-200 rounded-md" />
        <div className="h-10 bg-neutral-200 rounded-md" />
        <div className="h-10 bg-neutral-200 rounded-md" />
      </div>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-4">
      {/* Full name */}
      <div>
        <label htmlFor="sa-name" className="block text-sm font-medium text-neutral-700 mb-1">Full name</label>
        <input
          id="sa-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
        />
        {errors.name && <p className="text-sm text-red-600 mt-1">{errors.name}</p>}
      </div>

      {/* Address line 1 */}
      <div>
        <label htmlFor="sa-line1" className="block text-sm font-medium text-neutral-700 mb-1">Address</label>
        <input
          id="sa-line1"
          type="text"
          value={line1}
          onChange={(e) => setLine1(e.target.value)}
          className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
        />
        {errors.line1 && <p className="text-sm text-red-600 mt-1">{errors.line1}</p>}
      </div>

      {/* Address line 2 */}
      <div>
        <label htmlFor="sa-line2" className="block text-sm font-medium text-neutral-700 mb-1">Address line 2</label>
        <input
          id="sa-line2"
          type="text"
          value={line2}
          onChange={(e) => setLine2(e.target.value)}
          placeholder="Apt, suite, etc."
          className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
        />
      </div>

      {/* City + State + ZIP row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="sa-city" className="block text-sm font-medium text-neutral-700 mb-1">City</label>
          <input
            id="sa-city"
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
          />
          {errors.city && <p className="text-sm text-red-600 mt-1">{errors.city}</p>}
        </div>
        <div>
          <label htmlFor="sa-state" className="block text-sm font-medium text-neutral-700 mb-1">State</label>
          <select
            id="sa-state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
          >
            <option value="">Select...</option>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
          {errors.state && <p className="text-sm text-red-600 mt-1">{errors.state}</p>}
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="sa-zip" className="block text-sm font-medium text-neutral-700 mb-1">ZIP code</label>
          <input
            id="sa-zip"
            type="text"
            inputMode="numeric"
            maxLength={5}
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
          />
          {errors.postalCode && <p className="text-sm text-red-600 mt-1">{errors.postalCode}</p>}
        </div>
      </div>

      {/* Phone */}
      <div>
        <label htmlFor="sa-phone" className="block text-sm font-medium text-neutral-700 mb-1">Phone</label>
        <input
          id="sa-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="For delivery questions"
          className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
        />
      </div>

      {/* Save checkbox */}
      {isSignedIn && (
        <label className="flex items-center gap-2 text-sm text-neutral-600 mt-4 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={saveAddress}
            onChange={(e) => setSaveAddress(e.target.checked)}
            className="accent-neutral-900"
          />
          Save this address for future orders
        </label>
      )}

      {/* Buttons */}
      <div className="flex items-center justify-between gap-3 pt-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-neutral-500 hover:text-neutral-700"
          >
            ← Back
          </button>
        ) : <span />}
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 w-full sm:w-auto"
        >
          {saving ? "Saving..." : "Continue to shipping"}
        </button>
      </div>
    </form>
  );
}

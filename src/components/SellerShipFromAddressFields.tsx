"use client";

import { useState } from "react";
import AddressAutocomplete from "@/components/AddressAutocomplete";

const inputClass =
  "w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm";

export default function SellerShipFromAddressFields({
  defaults,
}: {
  defaults: {
    shipFromName?: string | null;
    shipFromLine1?: string | null;
    shipFromLine2?: string | null;
    shipFromCity?: string | null;
    shipFromState?: string | null;
    shipFromPostal?: string | null;
    shipFromCountry?: string | null;
  };
}) {
  const [line1, setLine1] = useState(defaults.shipFromLine1 ?? "");
  const [line2, setLine2] = useState(defaults.shipFromLine2 ?? "");
  const [city, setCity] = useState(defaults.shipFromCity ?? "");
  const [state, setState] = useState(defaults.shipFromState ?? "");
  const [postal, setPostal] = useState(defaults.shipFromPostal ?? "");
  const [country, setCountry] = useState(defaults.shipFromCountry ?? "US");

  return (
    <div className="space-y-3">
      <AddressAutocomplete
        id="ship-from-search"
        label="Search ship-from address"
        placeholder="Start typing an address"
        onSelect={(address) => {
          setLine1(address.line1);
          setCity(address.city);
          setState(address.state);
          setPostal(address.postalCode);
          setCountry(address.country || "US");
        }}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <input
          name="shipFromName"
          autoComplete="name"
          placeholder="Sender name"
          defaultValue={defaults.shipFromName ?? ""}
          className={inputClass}
        />
        <input
          name="shipFromLine1"
          autoComplete="address-line1"
          placeholder="Address line 1 *"
          value={line1}
          onChange={(event) => setLine1(event.target.value)}
          className={`${inputClass} md:col-span-2`}
        />
        <input
          name="shipFromLine2"
          autoComplete="address-line2"
          placeholder="Address line 2"
          value={line2}
          onChange={(event) => setLine2(event.target.value)}
          className={`${inputClass} md:col-span-2`}
        />
        <input
          name="shipFromCity"
          autoComplete="address-level2"
          placeholder="City *"
          value={city}
          onChange={(event) => setCity(event.target.value)}
          className={inputClass}
        />
        <input
          name="shipFromState"
          autoComplete="address-level1"
          placeholder="State * (e.g., TX)"
          value={state}
          onChange={(event) => setState(event.target.value.toUpperCase().slice(0, 2))}
          className={inputClass}
        />
        <input
          name="shipFromPostal"
          autoComplete="postal-code"
          placeholder="Postal code *"
          value={postal}
          onChange={(event) => setPostal(event.target.value)}
          className={inputClass}
        />
        <input
          name="shipFromCountry"
          autoComplete="country"
          placeholder="Country *"
          value={country}
          onChange={(event) => setCountry(event.target.value.toUpperCase().slice(0, 2))}
          className={inputClass}
        />
      </div>
    </div>
  );
}

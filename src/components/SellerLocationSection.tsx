"use client";
import { useState, useEffect } from "react";
import LocationPicker from "./LocationPicker";
import {
  exactMapConsentBinding,
  exactMapConsentBindingMatches,
  SELLER_EXACT_MAP_CONSENT_TEXT,
} from "@/lib/sellerExactMapConsent";

type Props = {
  defaultLat?: number | null;
  defaultLng?: number | null;
  defaultRadiusMeters?: number | null;
  defaultPublicMapOptIn?: boolean;
  defaultPublicMapExactConsent?: boolean;
};

export default function SellerLocationSection({
  defaultLat,
  defaultLng,
  defaultRadiusMeters,
  defaultPublicMapOptIn,
  defaultPublicMapExactConsent,
}: Props) {
  const [miles, setMiles] = useState(
    defaultRadiusMeters ? Math.round(defaultRadiusMeters / 1609.34) : 0
  );
  const hasRadius = miles > 0;

  // Fully controlled checkbox state — no mixed controlled/uncontrolled
  const [mapOptIn, setMapOptIn] = useState(
    !hasRadius && (defaultPublicMapOptIn ?? false)
  );
  const [exactConsent, setExactConsent] = useState(
    !hasRadius
    && (defaultPublicMapOptIn ?? false)
    && (defaultPublicMapExactConsent ?? false)
  );
  const [pin, setPin] = useState({
    lat: defaultLat ?? 30.2672,
    lng: defaultLng ?? -97.7431,
  });
  const [exactBinding, setExactBinding] = useState(() =>
    exactMapConsentBinding(
      !hasRadius
        && (defaultPublicMapOptIn ?? false)
        && (defaultPublicMapExactConsent ?? false),
      defaultLat ?? 30.2672,
      defaultLng ?? -97.7431,
    ),
  );

  // When radius is set, force-uncheck the makers map checkbox
  useEffect(() => {
    if (hasRadius) {
      setMapOptIn(false);
      setExactConsent(false);
      setExactBinding(null);
    }
  }, [hasRadius]);

  useEffect(() => {
    if (!mapOptIn) {
      setExactConsent(false);
      setExactBinding(null);
    }
  }, [mapOptIn]);

  return (
    <div className="space-y-3">
      <LocationPicker
        defaultLat={defaultLat}
        defaultLng={defaultLng}
        defaultRadiusMeters={defaultRadiusMeters}
        onMilesChange={(nextMiles) => {
          setMiles(nextMiles);
          if (nextMiles > 0) {
            setMapOptIn(false);
            setExactConsent(false);
            setExactBinding(null);
          }
        }}
        onLocationChange={(lat, lng) => {
          setPin({ lat, lng });
          if (!exactMapConsentBindingMatches(exactBinding, lat, lng)) {
            setExactConsent(false);
            setExactBinding(null);
          }
        }}
      />

      {hasRadius && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <strong>Note:</strong> Sellers with a radius set cannot appear on the public makers map — your approximate area is still shown on your shop page and listing pages. To enable makers map visibility, set your radius to 0.
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <input
          id="publicMapOptIn"
          name="publicMapOptIn"
          type="checkbox"
          checked={mapOptIn}
          onChange={(event) => {
            const checked = event.target.checked;
            setMapOptIn(checked);
            if (!checked) {
              setExactConsent(false);
              setExactBinding(null);
            }
          }}
          disabled={hasRadius}
          className="h-5 w-5 rounded border-neutral-300 accent-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <label
          htmlFor="publicMapOptIn"
          className={`text-sm ${hasRadius ? "text-neutral-500 cursor-not-allowed" : ""}`}
        >
          Show an approximate pin on the public makers map
          {hasRadius && (
            <span className="ml-1 text-xs text-amber-600">(disabled — radius set)</span>
          )}
        </label>
      </div>

      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
        <div className="flex items-start gap-2">
          <input
            id="publicMapExactConsent"
            name="publicMapExactConsent"
            type="checkbox"
            checked={exactConsent}
            onChange={(event) => {
              const checked = event.target.checked;
              setExactConsent(checked);
              setExactBinding(exactMapConsentBinding(checked, pin.lat, pin.lng));
            }}
            disabled={hasRadius || !mapOptIn}
            className="mt-0.5 h-5 w-5 rounded border-neutral-300 accent-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
          />
          <label
            htmlFor="publicMapExactConsent"
            className={`text-sm ${hasRadius || !mapOptIn ? "cursor-not-allowed text-neutral-500" : "text-amber-950"}`}
          >
            Publish this exact pin publicly
            <span className="mt-1 block text-xs leading-5">
              {SELLER_EXACT_MAP_CONSENT_TEXT}
            </span>
          </label>
        </div>
      </div>
      <input
        type="hidden"
        name="publicMapExactConsentVersion"
        value={exactBinding?.version ?? ""}
      />
      <input
        type="hidden"
        name="publicMapExactConsentLat"
        value={exactBinding?.lat ?? ""}
      />
      <input
        type="hidden"
        name="publicMapExactConsentLng"
        value={exactBinding?.lng ?? ""}
      />
    </div>
  );
}

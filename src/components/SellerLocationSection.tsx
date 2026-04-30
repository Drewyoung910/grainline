"use client";
import { useState, useEffect } from "react";
import LocationPicker from "./LocationPicker";

type Props = {
  defaultLat?: number | null;
  defaultLng?: number | null;
  defaultRadiusMeters?: number | null;
  defaultPublicMapOptIn?: boolean;
};

export default function SellerLocationSection({
  defaultLat,
  defaultLng,
  defaultRadiusMeters,
  defaultPublicMapOptIn,
}: Props) {
  const [miles, setMiles] = useState(
    defaultRadiusMeters ? Math.round(defaultRadiusMeters / 1609.34) : 0
  );
  const hasRadius = miles > 0;

  // Fully controlled checkbox state — no mixed controlled/uncontrolled
  const [mapOptIn, setMapOptIn] = useState(
    !hasRadius && (defaultPublicMapOptIn ?? false)
  );

  // When radius is set, force-uncheck the makers map checkbox
  useEffect(() => {
    if (hasRadius) setMapOptIn(false);
  }, [hasRadius]);

  return (
    <div className="space-y-3">
      <LocationPicker
        defaultLat={defaultLat}
        defaultLng={defaultLng}
        defaultRadiusMeters={defaultRadiusMeters}
        onMilesChange={setMiles}
      />

      {hasRadius && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <strong>Note:</strong> Sellers with a radius set cannot appear on the public makers map — your approximate area is still shown on your shop page and listing pages. To enable makers map visibility, set your radius to 0 (exact pin).
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <input
          id="publicMapOptIn"
          name="publicMapOptIn"
          type="checkbox"
          checked={mapOptIn}
          onChange={(e) => setMapOptIn(e.target.checked)}
          disabled={hasRadius}
          className="disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <label
          htmlFor="publicMapOptIn"
          className={`text-sm ${hasRadius ? "text-neutral-500 cursor-not-allowed" : ""}`}
        >
          Show me on the public makers map
          {hasRadius && (
            <span className="ml-1 text-xs text-amber-600">(disabled — radius set)</span>
          )}
        </label>
      </div>
    </div>
  );
}

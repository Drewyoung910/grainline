export const PUBLIC_LOCATION_METERS_PER_DEGREE = 111_320;

export const PUBLIC_LOCATION_GRID_CELLS_PER_DEGREE = 20;
export const COMMISSION_LOCATION_MIN_PRIVACY_RADIUS_METERS = 5_000;

type LocationPoint = Readonly<{
  lat: number;
  lng: number;
}>;

type PrivacySafeLocationPoint = LocationPoint & Readonly<{
  approximate: boolean;
}>;

function validLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function validLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function assertCoordinates(lat: number, lng: number) {
  if (!validLatitude(lat) || !validLongitude(lng)) {
    throw new RangeError("Location coordinates are outside the supported range");
  }
}

export function isSupportedLocationPoint(lat: number, lng: number) {
  return validLatitude(lat) && validLongitude(lng);
}

function cellCenter(value: number, minimum: number, maximum: number, cellSize: number) {
  const cellCount = Math.ceil((maximum - minimum) / cellSize);
  const cellIndex = Math.min(cellCount - 1, Math.floor((value - minimum) / cellSize));
  const lowerBound = minimum + cellIndex * cellSize;
  const upperBound = Math.min(maximum, lowerBound + cellSize);
  return (lowerBound + upperBound) / 2;
}

export function privacySafeLocationPoint({
  lat,
  lng,
  radiusMeters,
}: LocationPoint & Readonly<{ radiusMeters: number | null | undefined }>): PrivacySafeLocationPoint {
  assertCoordinates(lat, lng);
  const normalizedRadius = typeof radiusMeters === "number" && Number.isFinite(radiusMeters)
    ? radiusMeters
    : 0;
  if (normalizedRadius <= 0) {
    return Object.freeze({ lat, lng, approximate: false });
  }
  // A public deterministic seed would make an offset reversible. Quantization
  // is intentionally many-to-one: every private point in the same cell emits
  // the same public center. A cell side is one privacy radius, so the source
  // point remains inside the displayed radius even at a cell corner.
  const cellDegrees = normalizedRadius / PUBLIC_LOCATION_METERS_PER_DEGREE;
  return Object.freeze({
    lat: cellCenter(lat, -90, 90, cellDegrees),
    lng: cellCenter(lng, -180, 180, cellDegrees),
    approximate: true,
  });
}

export function coarsePublicLocationPoint({
  lat,
  lng,
  exactLocationOptIn = false,
}: LocationPoint & Readonly<{ exactLocationOptIn?: boolean }>): LocationPoint {
  assertCoordinates(lat, lng);
  if (exactLocationOptIn) return Object.freeze({ lat, lng });

  const cells = PUBLIC_LOCATION_GRID_CELLS_PER_DEGREE;
  const cellDegrees = 1 / cells;
  return Object.freeze({
    lat: cellCenter(lat, -90, 90, cellDegrees),
    lng: cellCenter(lng, -180, 180, cellDegrees),
  });
}

export function publicSellerLocationPoint({
  lat,
  lng,
  radiusMeters,
  exactLocationOptIn = false,
}: LocationPoint & Readonly<{
  radiusMeters: number | null | undefined;
  exactLocationOptIn?: boolean;
}>): PrivacySafeLocationPoint {
  const normalizedRadius = typeof radiusMeters === "number" && Number.isFinite(radiusMeters)
    ? radiusMeters
    : 0;
  if (normalizedRadius > 0) {
    return privacySafeLocationPoint({ lat, lng, radiusMeters: normalizedRadius });
  }

  const point = coarsePublicLocationPoint({ lat, lng, exactLocationOptIn });
  return Object.freeze({ ...point, approximate: !exactLocationOptIn });
}

export function commissionDistanceBucket(distanceMeters: number | null | undefined) {
  if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters) || distanceMeters < 0) return null;
  if (distanceMeters < 10 * 1609.344) return "Within 10 mi";
  if (distanceMeters < 25 * 1609.344) return "10–25 mi away";
  if (distanceMeters < 50 * 1609.344) return "25–50 mi away";
  return null;
}

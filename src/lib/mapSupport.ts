type MaplibreSupportApi = {
  supported?: (options?: { failIfMajorPerformanceCaveat?: boolean }) => boolean;
};

export function maplibreSupported(maplibre: unknown): boolean {
  const api = maplibre as MaplibreSupportApi;
  if (typeof api.supported !== "function") return true;
  try {
    return api.supported({ failIfMajorPerformanceCaveat: false });
  } catch {
    return false;
  }
}

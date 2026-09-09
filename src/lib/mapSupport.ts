type MaplibreSupportApi = {
  supported?: (options?: { failIfMajorPerformanceCaveat?: boolean }) => boolean;
};

export function maplibreSupported(maplibre: unknown): boolean {
  const api = maplibre as MaplibreSupportApi;
  try {
    if (typeof api.supported === "function") {
      return api.supported({ failIfMajorPerformanceCaveat: false });
    }
    // MapLibre 6 no longer exports supported() and requires WebGL 2. Probe
    // before constructing a Map: failed GPU initialization need not throw.
    if (typeof document === "undefined") return false;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false });
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

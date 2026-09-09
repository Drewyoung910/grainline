"use client";

import { getVersion, setWorkerUrl } from "maplibre-gl";

// Versioned same-origin assets are prepared for both development and builds.
// A worker must use the same release as the map running on the main thread.
setWorkerUrl(`/vendor/maplibre/${getVersion()}/maplibre-gl-worker.mjs`);

export * from "maplibre-gl";

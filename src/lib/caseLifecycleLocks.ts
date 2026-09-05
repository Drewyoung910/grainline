/**
 * Retired compatibility marker.
 *
 * The application no longer uses raw Case/Order lifecycle lock helpers. The
 * legacy primitives remain only inside the disposable race-proof harness so
 * the historical concurrency model stays reproducible without granting dead
 * application code an RLS bypass path.
 */
export {};

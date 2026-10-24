import {
  assertDisposablePostgresTarget,
  createPostgresAdapter,
} from "../postgres/adapter.mjs";

export function assertDisposablePostgres16Target(target, serverVersion) {
  return assertDisposablePostgresTarget(target, serverVersion, { expectedMajor: "16" });
}

// Pass a connected pg.Client. The caller owns connection lifecycle and all
// credentials; this module stores neither URLs nor passwords.
export function createPostgres16Adapter(client, { ownerRole = "ci" } = {}) {
  return createPostgresAdapter(client, { ownerRole });
}

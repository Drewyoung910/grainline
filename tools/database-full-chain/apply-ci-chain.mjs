import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
  assertDisposablePostgres16Target,
  createPostgres16Adapter,
} from "./postgres16/adapter.mjs";
import { createCiRoleScriptCallbacks } from "./scenarios/ci-role-scripts.mjs";
import {
  applyFullMigrationChain,
  findRepositoryRoot,
} from "./scenarios/migration-chain.mjs";

function requiredDatabaseUrl(env) {
  const value = env.DATABASE_FULL_CHAIN_PROOF_DATABASE_URL?.trim();
  if (!value)
    throw new Error("DATABASE_FULL_CHAIN_PROOF_DATABASE_URL is required");
  return value;
}

export async function applyDisposableCiMigrationChain(
  env = process.env,
  {
    Client = pg.Client,
    log = (message) => process.stderr.write(`${message}\n`),
  } = {},
) {
  const databaseUrl = requiredDatabaseUrl(env);
  assertDisposablePostgres16Target(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const identity = (
      await client.query(`
      SELECT current_user,
             current_database(),
             current_setting('server_version') AS server_version
    `)
    ).rows[0];
    assert.equal(identity.current_user, "ci");
    assert.equal(identity.current_database, "grainline_ci");
    assertDisposablePostgres16Target(databaseUrl, identity.server_version);

    const adapter = createPostgres16Adapter(client);
    const roles = createCiRoleScriptCallbacks({ log });
    const summary = await applyFullMigrationChain({
      adapter,
      repositoryRoot: findRepositoryRoot(),
      engine: "postgres16",
      bootstrapRoles: roles.bootstrapRoles,
      convergeRoles: roles.convergeRoles,
      onProgress: ({ index, name, total }) => {
        if (index === total || index % 50 === 0) {
          log(`Applied migration ${index}/${total}: ${name}`);
        }
      },
    });
    return Object.freeze({
      migrationCount: summary.migrationCount,
      lastMigration: summary.applied.at(-1),
      roleConvergenceRetries: summary.roleConvergenceRetries,
    });
  } finally {
    await client.end();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (invokedPath === import.meta.url) {
  applyDisposableCiMigrationChain()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}

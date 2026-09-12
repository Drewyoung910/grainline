// Private grant connection, separate from the engine-read-only scope reader.
// Identity is observed without SET ROLE or overriding database/role defaults.
import assert from "node:assert/strict";

export async function connectOrderGrantOwner({ Client, databaseUrl, channelBinding, guard, onLost }) {
  await guard();
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000,
    statement_timeout: 30000, query_timeout: 35000, application_name: "grainline-order-prefix-grants",
    ...channelBinding(new URL(databaseUrl)) });
  client.on("error", onLost);
  try {
    await client.connect(); await guard();
    const identity = await client.query(`SELECT current_database() AS database,
      current_user AS actor, session_user AS login,
      current_setting('transaction_read_only') AS read_only`);
    assert.deepEqual(identity.rows, [{ database: "neondb", actor: "neondb_owner", login: "neondb_owner", read_only: "off" }]);
    await guard(); return client;
  } catch {
    try { await client.end(); } catch { /* The owning worker also terminates on failure. */ }
    throw new Error("Order grant owner connection rejected");
  }
}

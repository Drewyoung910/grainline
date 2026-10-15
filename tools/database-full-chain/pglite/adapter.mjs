import { splitSqlStatements } from "../scenarios/migration-chain.mjs";

// Dependency injection keeps the tracked harness independent from Claude's
// scratch-only package tree. Pass an already-created PGlite database here.
export function createPgliteAdapter(database, { ownerRole = "ci" } = {}) {
  if (!database?.query || !database?.exec) {
    throw new TypeError("a PGlite-compatible database is required");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(ownerRole)) {
    throw new Error("ownerRole must be a PostgreSQL identifier");
  }
  return Object.freeze({
    query: (sql, params = []) => database.query(sql, params),
    executeMigration: async (sql) => {
      // PGlite executes a multi-statement string in one implicit transaction.
      // The migration planner removes CONCURRENTLY only for this engine.
      await database.exec(sql);
    },
    executeStatements: async (sql) => {
      for (const statement of splitSqlStatements(sql)) await database.exec(statement);
    },
    resetOwner: async () => {
      try {
        await database.exec("ROLLBACK");
      } catch {}
      await database.exec(`SET SESSION AUTHORIZATION ${ownerRole}`);
      await database.exec("SET TIME ZONE 'UTC'");
    },
  });
}

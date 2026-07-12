// Turso driver: hosted libSQL over fetch/websocket. The '/web' entry point
// has no native dependencies, which keeps serverless bundles small. The
// schema is ensured once per process, on first use.
import { createClient } from '@libsql/client/web';
import { isDuplicateColumnError, MIGRATION_STATEMENTS, SCHEMA_STATEMENTS } from './schema.js';

export function createTursoDb({
  url = process.env.TURSO_DATABASE_URL,
  authToken = process.env.TURSO_AUTH_TOKEN,
} = {}) {
  if (!url) throw new Error('TURSO_DATABASE_URL is not set');
  const client = createClient({ url, authToken });

  let ready = null;
  const applySchema = async () => {
    await client.batch(SCHEMA_STATEMENTS, 'write');
    for (const sql of MIGRATION_STATEMENTS) {
      try {
        await client.execute(sql);
      } catch (err) {
        if (!isDuplicateColumnError(err)) throw err;
      }
    }
  };
  const ensureSchema = () => {
    ready ??= applySchema().catch((err) => {
      ready = null; // let the next request retry instead of caching the failure
      throw err;
    });
    return ready;
  };

  return {
    async query(sql, args = []) {
      await ensureSchema();
      return (await client.execute({ sql, args })).rows;
    },

    async run(sql, args = []) {
      await ensureSchema();
      const result = await client.execute({ sql, args });
      return { changes: result.rowsAffected };
    },

    async batch(statements) {
      await ensureSchema();
      await client.batch(
        statements.map(({ sql, args = [] }) => ({ sql, args })),
        'write',
      );
    },

    async close() {
      client.close();
    },
  };
}

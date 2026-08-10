import pg from 'pg';
import type { Queryable } from './executor.js';

/**
 * A single dedicated connection, not a Pool — the executor sends raw BEGIN/COMMIT/ROLLBACK
 * as plain statements, which only stay in the same transaction if every query in a batch
 * runs on the same underlying connection. A Pool would silently hand out a different
 * connection per query and break transaction semantics.
 */
export async function connectPgQueryable(
  connectionString: string,
): Promise<{ queryable: Queryable; close: () => Promise<void> }> {
  const client = new pg.Client({
    connectionString,
    // Supabase's direct/pooler connections terminate TLS with a cert chain most local trust
    // stores don't have; this tool is run by a trusted operator against a known project, not
    // a public-facing service, so we accept that instead of vendoring Supabase's CA bundle.
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return {
    queryable: {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        const result = await client.query(sql, params as unknown[]);
        return { rows: result.rows as T[] };
      },
    },
    close: () => client.end(),
  };
}

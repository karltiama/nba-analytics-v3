/**
 * Standalone copy of lib/db/schema-capability.ts for the injuries Lambda package.
 * Keep in sync with the lib module.
 */

export type SqlQueryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type CollectionSchemaMode = 'optional' | 'required';

export class CollectionSchemaPreflightError extends Error {
  readonly code = 'COLLECTION_SCHEMA_PREFLIGHT';
  readonly missing: string[];
  constructor(missing: string[]) {
    super(
      `Required collection schema is missing: ${missing.join(', ')}. Apply db/schemas/MIGRATION_context_collection_snapshots.sql before activating writes.`
    );
    this.name = 'CollectionSchemaPreflightError';
    this.missing = missing;
  }
}

export function readCollectionSchemaMode(
  env: Record<string, string | undefined> = process.env
): CollectionSchemaMode {
  return env.COLLECTION_SCHEMA_MODE === 'required' ? 'required' : 'optional';
}

export async function relationExists(
  client: SqlQueryable,
  qualifiedName: string
): Promise<boolean> {
  const res = await client.query(`SELECT to_regclass($1) AS rel`, [qualifiedName]);
  return res.rows[0]?.rel != null;
}

export async function columnExists(
  client: SqlQueryable,
  schemaName: string,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 AS ok
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
      LIMIT 1`,
    [schemaName, tableName, columnName]
  );
  return res.rows.length > 0;
}

export type InjuryCollectionSchema = {
  membershipTable: boolean;
  completenessReasonColumn: boolean;
  healthClassColumn: boolean;
  ready: boolean;
  missing: string[];
};

export async function inspectInjuryCollectionSchema(
  client: SqlQueryable
): Promise<InjuryCollectionSchema> {
  const membershipTable = await relationExists(client, 'raw.injury_pull_membership');
  const completenessReasonColumn = await columnExists(
    client,
    'raw',
    'injury_pull_runs',
    'completeness_reason'
  );
  const healthClassColumn = await columnExists(client, 'raw', 'injury_pull_runs', 'health_class');
  const missing: string[] = [];
  if (!membershipTable) missing.push('raw.injury_pull_membership');
  if (!completenessReasonColumn) missing.push('raw.injury_pull_runs.completeness_reason');
  if (!healthClassColumn) missing.push('raw.injury_pull_runs.health_class');
  return {
    membershipTable,
    completenessReasonColumn,
    healthClassColumn,
    ready: missing.length === 0,
    missing,
  };
}

export function assertSchemaReady(args: {
  mode: CollectionSchemaMode;
  ready: boolean;
  missing: string[];
}): void {
  if (args.mode === 'required' && !args.ready) {
    throw new CollectionSchemaPreflightError(args.missing);
  }
}

export async function withSavepoint<T>(
  client: SqlQueryable,
  name: string,
  fn: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const ident = name.replace(/[^a-zA-Z0-9_]/g, '_');
  await client.query(`SAVEPOINT ${ident}`);
  try {
    const value = await fn();
    await client.query(`RELEASE SAVEPOINT ${ident}`);
    return { ok: true, value };
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${ident}`);
    return { ok: false, error };
  }
}

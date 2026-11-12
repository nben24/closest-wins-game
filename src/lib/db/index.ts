import fs from "node:fs";
import path from "node:path";
import { appMode, assertDeployable, env } from "@/lib/env";

/**
 * Minimal database interface shared by production (node-postgres against
 * Supabase Postgres) and local development / tests (PGlite, an embedded
 * Postgres). The same SQL migrations run on both.
 */
export type Row = Record<string, unknown>;

export interface Sql {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(text: string, params?: unknown[]): Promise<T | null>;
}

export interface Db extends Sql {
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  /** Run multi-statement SQL (migrations) in one transaction. */
  exec(text: string): Promise<void>;
  close(): Promise<void>;
  kind: "pg" | "pglite";
}

/** Postgres error raised by our integrity triggers. */
export function isGuardError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P0001";
}

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

function wrap(query: (text: string, params?: unknown[]) => Promise<Row[]>): Sql {
  return {
    query: async <T>(text: string, params?: unknown[]) => (await query(text, params)) as T[],
    one: async <T>(text: string, params?: unknown[]) => ((await query(text, params))[0] as T) ?? null,
  };
}

// --- node-postgres --------------------------------------------------------

async function createPgDb(connectionString: string): Promise<Db> {
  const pg = await import("pg");
  const { Pool, types } = pg.default ?? pg;
  types.setTypeParser(1082, (v: string) => v); // date -> 'YYYY-MM-DD'
  types.setTypeParser(20, (v: string) => Number(v)); // int8 -> number (counts are small)
  types.setTypeParser(1700, (v: string) => Number(v)); // numeric -> number

  // node-postgres lets `sslmode` in the URL override the ssl object, so strip
  // it and configure TLS explicitly. Supabase's pooler certificate chains to
  // Supabase's own CA; provide it via DATABASE_CA_CERT for full verification.
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  const isLocalHost = ["localhost", "127.0.0.1"].includes(url.hostname);
  const ca = env.databaseCaCert?.replace(/\\n/g, "\n");
  const pool = new Pool({
    connectionString: url.toString(),
    max: Number(process.env.DATABASE_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: isLocalHost ? undefined : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  });
  const run = async (text: string, params?: unknown[]) => (await pool.query(text, params as unknown[])).rows as Row[];
  return {
    kind: "pg",
    ...wrap(run),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(wrap(async (t, p) => (await client.query(t, p as unknown[])).rows as Row[]));
        await client.query("commit");
        return result;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async exec(text) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(text);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// --- PGlite -----------------------------------------------------------------

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  if (dataDir && !dataDir.startsWith("memory://")) fs.mkdirSync(dataDir, { recursive: true });
  const db = await PGlite.create(dataDir, {
    parsers: {
      [types.DATE]: (v: string) => v,
      [types.NUMERIC]: (v: string) => Number(v),
      [types.INT8]: (v: string) => Number(v),
    },
  });
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;`);
  // PGlite is single-connection: serialize transactions with a promise chain so
  // concurrent requests in dev do not interleave statements.
  let chain: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  const run = (text: string, params?: unknown[]) =>
    serialize(async () => (await db.query(text, params as unknown[])).rows as Row[]);
  const sql: Db = {
    kind: "pglite",
    ...wrap(run),
    tx: (fn) =>
      serialize(() =>
        db.transaction(async (tx) => fn(wrap(async (t, p) => (await tx.query(t, p as unknown[])).rows as Row[]))),
      ),
    exec: (text) =>
      serialize(async () => {
        await db.transaction(async (tx) => {
          await tx.exec(text);
        });
      }),
    close: () => db.close(),
  };
  await runMigrations(sql);
  if (process.env.LOCAL_SEED_DEMO !== "false" && dataDir && !dataDir.startsWith("memory://")) {
    const count = await sql.one<{ n: number }>("select count(*)::int as n from questions");
    if (count && count.n === 0) {
      const { seedDemoQuestions } = await import("@/lib/db/seed");
      await seedDemoQuestions(sql);
    }
  }
  return sql;
}

// --- migrations ----------------------------------------------------------

export function migrationFiles(): { name: string; sql: string }[] {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f.replace(/\.sql$/, ""), sql: fs.readFileSync(path.join(dir, f), "utf8") }));
}

export async function runMigrations(db: Db, log: (m: string) => void = () => {}): Promise<string[]> {
  await db.query(
    "create table if not exists app_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const applied = new Set((await db.query<{ name: string }>("select name from app_migrations")).map((r) => r.name));
  const ran: string[] = [];
  for (const m of migrationFiles()) {
    if (applied.has(m.name)) continue;
    log(`Applying ${m.name}…`);
    await db.exec(m.sql);
    await db.query("insert into app_migrations (name) values ($1) on conflict do nothing", [m.name]);
    ran.push(m.name);
  }
  return ran;
}

// --- singleton -----------------------------------------------------------

const globalForDb = globalThis as unknown as { __closestWinsDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.__closestWinsDb) {
    assertDeployable();
    globalForDb.__closestWinsDb =
      appMode() === "supabase"
        ? createPgDb(env.databaseUrl!)
        : env.localDbDir === "memory://"
          ? createPgliteDb("memory://").then(async (db) => {
              // Ephemeral database (used by end-to-end tests): seed demo content.
              const { seedDemoQuestions } = await import("@/lib/db/seed");
              await seedDemoQuestions(db);
              return db;
            })
          : createPgliteDb(path.resolve(/* turbopackIgnore: true */ process.cwd(), env.localDbDir));
    globalForDb.__closestWinsDb.catch(() => {
      globalForDb.__closestWinsDb = undefined;
    });
  }
  return globalForDb.__closestWinsDb;
}

/** Test hook: use a specific database instance. */
export function setDbForTests(db: Db | undefined): void {
  globalForDb.__closestWinsDb = db ? Promise.resolve(db) : undefined;
}

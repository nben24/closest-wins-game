import { describe, expect, it } from "vitest";
import { createPgliteDb } from "@/lib/db";

describe("migrations", () => {
  it("apply cleanly and lock every table down", async () => {
    const db = await createPgliteDb("memory://");
    const tables = await db.query<{ tablename: string; rowsecurity: boolean }>(
      "select tablename, rowsecurity from pg_tables where schemaname = 'public'",
    );
    expect(tables.length).toBeGreaterThan(10);
    for (const t of tables) expect(t.rowsecurity, t.tablename).toBe(true);
    const grants = await db.query(
      "select table_name, grantee from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')",
    );
    expect(grants).toEqual([]);
    await db.close();
  });
});

import "server-only";
import type { Sql } from "@/lib/db";
import { getDb } from "@/lib/db";

/** Admin notifications shown on the dashboard. Deduplicated while unresolved. */
export async function notifyAdmin(
  kind: string,
  severity: "info" | "warning" | "error",
  message: string,
  dedupeKey?: string,
  sql?: Sql,
): Promise<void> {
  const db = sql ?? (await getDb());
  await db.query(
    `insert into admin_notifications (kind, severity, message, dedupe_key) values ($1, $2, $3, $4)
     on conflict (dedupe_key) where resolved_at is null and dedupe_key is not null do nothing`,
    [kind, severity, message, dedupeKey ?? null],
  );
}

export async function audit(
  actor: string,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
  sql?: Sql,
): Promise<void> {
  const db = sql ?? (await getDb());
  await db.query(
    "insert into audit_log (actor, action, entity_type, entity_id, details) values ($1, $2, $3, $4, $5)",
    [actor, action, entityType, entityId, JSON.stringify(details)],
  );
}

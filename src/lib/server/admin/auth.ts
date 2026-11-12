import "server-only";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { appMode } from "@/lib/env";
import { forbidden } from "@/lib/server/errors";
import { getIdentity, LOCAL_ADMIN_USER_ID } from "@/lib/server/identity";

export interface AdminUser {
  authUserId: string;
  email: string | null;
  /** Identifier recorded in the audit log. */
  actor: string;
}

/**
 * Server-side admin check. Every admin page, server action and API route
 * calls this; hiding links is not relied on.
 *  - Supabase: a non-anonymous Supabase Auth user listed in `admins`.
 *  - Local dev: the signed local-admin cookie (LOCAL_ADMIN_PASSWORD).
 */
export async function getAdmin(): Promise<AdminUser | null> {
  const identity = await getIdentity();
  if (!identity) return null;
  if (appMode() === "local") {
    return identity.authUserId === LOCAL_ADMIN_USER_ID ? { authUserId: identity.authUserId, email: identity.email, actor: "admin:local" } : null;
  }
  if (identity.isAnonymous) return null;
  const db = await getDb();
  const row = await db.one<{ email: string | null }>("select email from admins where auth_user_id = $1", [identity.authUserId]);
  if (!row) return null;
  return { authUserId: identity.authUserId, email: identity.email ?? row.email, actor: `admin:${identity.email ?? identity.authUserId}` };
}

/** For pages: redirect to login. */
export async function requireAdminPage(): Promise<AdminUser> {
  const a = await getAdmin();
  if (!a) redirect("/admin/login");
  return a;
}

/** For actions / API routes: throw 403. */
export async function requireAdmin(): Promise<AdminUser> {
  const a = await getAdmin();
  if (!a) throw forbidden();
  return a;
}

/**
 * Make an existing Supabase Auth user an administrator.
 *   npm run admin:grant -- you@example.com
 *   npm run admin:grant -- --revoke you@example.com
 *
 * Create the user first (Supabase dashboard → Authentication → Users → Add
 * user, with a strong password). Anonymous users can never be admins.
 * Requires DATABASE_URL (a role that can read auth.users, e.g. postgres).
 */
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";

async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");
  const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    console.error("Usage: npm run admin:grant -- [--revoke] you@example.com");
    process.exit(1);
  }
  if (!env.databaseUrl) {
    console.error("DATABASE_URL is not set. In local mode, sign in to /admin with LOCAL_ADMIN_PASSWORD instead.");
    process.exit(1);
  }
  const db = await getDb();
  const user = await db.one<{ id: string; is_anonymous: boolean }>(
    "select id, coalesce(is_anonymous, false) as is_anonymous from auth.users where lower(email) = $1",
    [email],
  );
  if (!user) {
    console.error(`No Supabase Auth user with email ${email}. Create it in the Supabase dashboard first.`);
    process.exit(1);
  }
  if (user.is_anonymous) {
    console.error("Anonymous users cannot be administrators.");
    process.exit(1);
  }
  if (revoke) {
    await db.query("delete from admins where auth_user_id = $1", [user.id]);
    await db.query("insert into audit_log (actor, action, entity_type, entity_id) values ('cli', 'revoke_admin', 'admin', $1)", [user.id]);
    console.log(`Revoked admin for ${email}.`);
  } else {
    await db.query("insert into admins (auth_user_id, email, granted_by) values ($1, $2, 'cli') on conflict (auth_user_id) do update set email = excluded.email", [user.id, email]);
    await db.query("insert into audit_log (actor, action, entity_type, entity_id) values ('cli', 'grant_admin', 'admin', $1)", [user.id]);
    console.log(`${email} is now an administrator.`);
  }
  await db.close();
}

main().catch((e) => {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

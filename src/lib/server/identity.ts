import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { appMode, env } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Who is making this request. Identity is never derived from a nickname.
 *
 *  - Supabase mode: a verified Supabase Auth JWT (anonymous sign-in for
 *    players; email/password for administrators).
 *  - Local mode: an HMAC-signed, httpOnly cookie holding a random id.
 */
export interface Identity {
  authUserId: string;
  isAnonymous: boolean;
  email: string | null;
}

const LOCAL_COOKIE = "cw_local_uid";
const LOCAL_ADMIN_COOKIE = "cw_local_admin";
export const LOCAL_ADMIN_USER_ID = "00000000-0000-4000-8000-00000000ad01";

function sign(value: string): string {
  return crypto.createHmac("sha256", env.localSessionSecret).update(value).digest("base64url");
}

function verifySigned(raw: string | undefined): string | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const value = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = sign(value);
  if (sig.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? value : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getIdentity(): Promise<Identity | null> {
  if (appMode() === "supabase") {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims?.sub || !UUID_RE.test(String(claims.sub))) return null;
    return {
      authUserId: String(claims.sub),
      isAnonymous: Boolean(claims.is_anonymous),
      email: typeof claims.email === "string" && claims.email ? claims.email : null,
    };
  }
  const store = await cookies();
  if (verifySigned(store.get(LOCAL_ADMIN_COOKIE)?.value) === "admin") {
    return { authUserId: LOCAL_ADMIN_USER_ID, isAnonymous: false, email: "local-admin@localhost" };
  }
  const id = verifySigned(store.get(LOCAL_COOKIE)?.value);
  if (!id || !UUID_RE.test(id)) return null;
  return { authUserId: id, isAnonymous: true, email: null };
}

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && !process.env.PLAYWRIGHT,
  path: "/",
  maxAge: 60 * 60 * 24 * 400,
};

/** Local mode only: create the signed guest cookie if missing. */
export async function ensureLocalIdentity(): Promise<Identity> {
  const existing = await getIdentity();
  if (existing) return existing;
  const id = crypto.randomUUID();
  const store = await cookies();
  store.set(LOCAL_COOKIE, `${id}.${sign(id)}`, cookieOpts);
  return { authUserId: id, isAnonymous: true, email: null };
}

export async function setLocalAdminCookie(): Promise<void> {
  const store = await cookies();
  store.set(LOCAL_ADMIN_COOKIE, `admin.${sign("admin")}`, { ...cookieOpts, maxAge: 60 * 60 * 12 });
}

export async function clearLocalAdminCookie(): Promise<void> {
  const store = await cookies();
  store.delete(LOCAL_ADMIN_COOKIE);
}

export function checkLocalAdminPassword(input: string): boolean {
  const expected = env.localAdminPassword;
  if (!expected || appMode() !== "local" || env.isVercel) return false;
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

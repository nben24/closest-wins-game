import { NextResponse } from "next/server";
import { z } from "zod";
import { appMode, env } from "@/lib/env";
import { ApiError, readJson, route } from "@/lib/server/errors";
import { checkLocalAdminPassword, setLocalAdminCookie } from "@/lib/server/identity";
import { clientIpHash, rateLimit } from "@/lib/server/ratelimit";

/** Local development only. Production admins sign in with Supabase Auth. */
export const POST = route(async (req: Request) => {
  if (appMode() !== "local" || env.isVercel) throw new ApiError(404, "not_found", "Not found.");
  if (!env.localAdminPassword) throw new ApiError(503, "not_configured", "Set LOCAL_ADMIN_PASSWORD in .env.local to use the local admin.");
  await rateLimit(`local-admin:${await clientIpHash()}`, 10, 600);
  const { password } = z.object({ password: z.string().max(200) }).parse(await readJson(req));
  if (!checkLocalAdminPassword(password)) throw new ApiError(401, "bad_password", "Incorrect password.");
  await setLocalAdminCookie();
  return NextResponse.json({ ok: true });
});

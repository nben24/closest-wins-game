import { NextResponse } from "next/server";
import { appMode } from "@/lib/env";
import { ApiError, route } from "@/lib/server/errors";
import { ensureLocalIdentity } from "@/lib/server/identity";
import { clientIpHash, rateLimit } from "@/lib/server/ratelimit";

/** Local mode only: create the signed guest cookie. Supabase mode signs in anonymously in the browser. */
export const POST = route(async () => {
  if (appMode() !== "local") throw new ApiError(400, "use_supabase", "Sign in anonymously with Supabase Auth.");
  await rateLimit(`session:${await clientIpHash()}`, 30, 3600);
  await ensureLocalIdentity();
  return NextResponse.json({ ok: true });
});

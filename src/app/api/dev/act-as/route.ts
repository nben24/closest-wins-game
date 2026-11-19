import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { devToolsAllowed } from "@/lib/server/dev";
import { route } from "@/lib/server/errors";
import { setLocalPlayerCookieForDev } from "@/lib/server/identity";
import { isGameDate } from "@/lib/time";

/** LOCAL TESTING ONLY. Switch this browser to an existing local player, then go back to the preview page. */
export const GET = route(async (req: Request) => {
  if (!devToolsAllowed()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = new URL(req.url);
  const db = await getDb();
  const p = await db.one<{ auth_user_id: string }>("select auth_user_id from players where id::text = $1", [url.searchParams.get("player") ?? ""]);
  if (!p) return NextResponse.json({ error: "No such player." }, { status: 404 });
  await setLocalPlayerCookieForDev(p.auth_user_id);
  const date = url.searchParams.get("date");
  return NextResponse.redirect(new URL(`/dev/guesses${date && isGameDate(date) ? `?date=${date}` : ""}`, url));
});

import { NextResponse } from "next/server";
import { route } from "@/lib/server/errors";
import { leadersSummary } from "@/lib/server/leaderboard";
import { requirePlayer } from "@/lib/server/players";
import { myLastWeekPrize } from "@/lib/server/prizes";

/**
 * Who's leading today / this week / last week, for the home screen (scores only),
 * plus the viewer's OWN prize code if they finished top 3 last week.
 */
export const GET = route(async () => {
  const player = await requirePlayer();
  const [leaders, prize] = await Promise.all([leadersSummary(player.id), myLastWeekPrize(player.id)]);
  return NextResponse.json({ leaders, prize }, { headers: { "Cache-Control": "no-store" } });
});

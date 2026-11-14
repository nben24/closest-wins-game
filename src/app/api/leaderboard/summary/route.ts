import { NextResponse } from "next/server";
import { route } from "@/lib/server/errors";
import { leadersSummary } from "@/lib/server/leaderboard";
import { requirePlayer } from "@/lib/server/players";

/** Who's leading today / this week / last week, for the home screen. Scores only. */
export const GET = route(async () => {
  const player = await requirePlayer();
  const leaders = await leadersSummary(player.id);
  return NextResponse.json({ leaders }, { headers: { "Cache-Control": "no-store" } });
});

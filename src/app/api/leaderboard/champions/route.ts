import { NextResponse } from "next/server";
import { route } from "@/lib/server/errors";
import { pastWeeks } from "@/lib/server/leaderboard";
import { requirePlayer } from "@/lib/server/players";

/** Top three of each finished week, newest first. */
export const GET = route(async () => {
  const player = await requirePlayer();
  const weeks = await pastWeeks(player.id, 8);
  return NextResponse.json({ weeks }, { headers: { "Cache-Control": "no-store" } });
});

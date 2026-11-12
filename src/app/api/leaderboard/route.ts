import { NextResponse } from "next/server";
import { ApiError, route } from "@/lib/server/errors";
import { dailyBoard, weeklyBoard } from "@/lib/server/leaderboard";
import { requirePlayer } from "@/lib/server/players";
import { today } from "@/lib/server/challenges";
import { isGameDate } from "@/lib/time";

export const GET = route(async (req: Request) => {
  const player = await requirePlayer();
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") === "week" ? "week" : "day";
  const date = url.searchParams.get("date") ?? today();
  if (!isGameDate(date) || date > today()) throw new ApiError(400, "invalid_date", "Invalid date.");
  const board = scope === "week" ? await weeklyBoard(player.id, date) : await dailyBoard(player.id, date);
  return NextResponse.json({ board }, { headers: { "Cache-Control": "no-store" } });
});

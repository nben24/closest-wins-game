import { NextResponse } from "next/server";
import { ApiError, route } from "@/lib/server/errors";
import { requirePlayer } from "@/lib/server/players";
import { getResults } from "@/lib/server/results";
import { today } from "@/lib/server/challenges";
import { isGameDate } from "@/lib/time";

export const GET = route(async (req: Request) => {
  const player = await requirePlayer();
  const date = new URL(req.url).searchParams.get("date") ?? today();
  if (!isGameDate(date)) throw new ApiError(400, "invalid_date", "Invalid date.");
  return NextResponse.json(await getResults(player.id, date), { headers: { "Cache-Control": "no-store" } });
});

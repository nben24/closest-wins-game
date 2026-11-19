import { NextResponse } from "next/server";
import { ApiError, route } from "@/lib/server/errors";
import { dayGuesses } from "@/lib/server/guesses";
import { requirePlayer } from "@/lib/server/players";
import { today } from "@/lib/server/challenges";
import { isGameDate } from "@/lib/time";

/** Everyone's guesses for a day — only for players who finished that day (see dayGuesses). */
export const GET = route(async (req: Request) => {
  const player = await requirePlayer();
  const date = new URL(req.url).searchParams.get("date") ?? today();
  if (!isGameDate(date) || date > today()) throw new ApiError(400, "invalid_date", "Invalid date.");
  return NextResponse.json({ guesses: await dayGuesses(player.id, date) }, { headers: { "Cache-Control": "no-store" } });
});

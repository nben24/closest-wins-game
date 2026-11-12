import { NextResponse } from "next/server";
import { route } from "@/lib/server/errors";
import { requirePlayer } from "@/lib/server/players";
import { getHistory } from "@/lib/server/results";

export const GET = route(async () => {
  const player = await requirePlayer();
  return NextResponse.json({ history: await getHistory(player.id) });
});

import { NextResponse } from "next/server";
import { route } from "@/lib/server/errors";
import { getPlayState } from "@/lib/server/play";
import { requirePlayer } from "@/lib/server/players";

export const GET = route(async () => {
  const player = await requirePlayer();
  return NextResponse.json(await getPlayState(player.id), { headers: { "Cache-Control": "no-store" } });
});

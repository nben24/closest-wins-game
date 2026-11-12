import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, route } from "@/lib/server/errors";
import { beginRound } from "@/lib/server/play";
import { requirePlayer } from "@/lib/server/players";
import { rateLimit } from "@/lib/server/ratelimit";

const Body = z.object({ challengeId: z.string().uuid(), position: z.number().int().min(1).max(5) });

export const POST = route(async (req: Request) => {
  const player = await requirePlayer();
  await rateLimit(`play:${player.id}`, 120, 60);
  const body = Body.parse(await readJson(req));
  return NextResponse.json(await beginRound(player.id, body.challengeId, body.position), { headers: { "Cache-Control": "no-store" } });
});

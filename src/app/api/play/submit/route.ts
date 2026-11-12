import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, route } from "@/lib/server/errors";
import { submitRound } from "@/lib/server/play";
import { requirePlayer } from "@/lib/server/players";
import { rateLimit } from "@/lib/server/ratelimit";

const Body = z.object({
  challengeId: z.string().uuid(),
  position: z.number().int().min(1).max(5),
  guess: z.string().max(40).nullable(),
  submissionId: z.string().max(64).nullable().optional(),
});

export const POST = route(async (req: Request) => {
  const player = await requirePlayer();
  await rateLimit(`play:${player.id}`, 120, 60);
  const body = Body.parse(await readJson(req));
  const result = await submitRound(player.id, body.challengeId, body.position, body.guess, body.submissionId ?? null);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
});

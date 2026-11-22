import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, route } from "@/lib/server/errors";
import { REPORT_MAX_CHARS, reportProblem, setReaction } from "@/lib/server/feedback";
import { requirePlayer } from "@/lib/server/players";
import { rateLimit } from "@/lib/server/ratelimit";

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  position: z.number().int().min(1).max(5),
  reaction: z.union([z.literal(1), z.literal(-1), z.null()]).optional(),
  report: z.string().max(REPORT_MAX_CHARS * 2).optional(),
});

/** A player's thumbs up/down or problem report on a question they already finished. */
export const POST = route(async (req: Request) => {
  const player = await requirePlayer();
  await rateLimit(`feedback:${player.id}`, 40, 60);
  const body = Body.parse(await readJson(req));
  if (body.report !== undefined) await reportProblem(player.id, body.date, body.position, body.report);
  else if (body.reaction !== undefined) await setReaction(player.id, body.date, body.position, body.reaction);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});

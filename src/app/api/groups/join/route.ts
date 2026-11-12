import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, readJson, route } from "@/lib/server/errors";
import { joinGroup, normalizeInviteCode } from "@/lib/server/groups";
import { requirePlayer } from "@/lib/server/players";
import { clientIpHash, rateLimit } from "@/lib/server/ratelimit";

const Body = z.object({ code: z.string().max(32) });

export const POST = route(async (req: Request) => {
  const player = await requirePlayer();
  // Invite codes are guessable only by brute force; keep that impractical.
  await rateLimit(`join:${player.id}`, 10, 600);
  await rateLimit(`join-ip:${await clientIpHash()}`, 30, 600);
  const code = normalizeInviteCode(Body.parse(await readJson(req)).code);
  if (!code) throw new ApiError(400, "invalid_code", "Invite codes are 8 letters and numbers.");
  return NextResponse.json({ group: await joinGroup(player.id, code) });
});

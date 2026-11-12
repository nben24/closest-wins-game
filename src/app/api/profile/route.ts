import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, route, unauthorized } from "@/lib/server/errors";
import { getIdentity } from "@/lib/server/identity";
import { saveProfile } from "@/lib/server/players";
import { rateLimit } from "@/lib/server/ratelimit";

const Body = z.object({ avatarId: z.string().max(32), adjective: z.string().max(32), noun: z.string().max(32) });

export const POST = route(async (req: Request) => {
  const identity = await getIdentity();
  if (!identity) throw unauthorized();
  await rateLimit(`profile:${identity.authUserId}`, 20, 3600);
  const body = Body.parse(await readJson(req));
  const player = await saveProfile(identity, body.avatarId, body.adjective, body.noun);
  return NextResponse.json({ player: { id: player.id, name: player.name, avatarId: player.avatarId, adjective: player.adjective, noun: player.noun } });
});

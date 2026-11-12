import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, route } from "@/lib/server/errors";
import { createGroup, listMyGroups } from "@/lib/server/groups";
import { requirePlayer } from "@/lib/server/players";
import { rateLimit } from "@/lib/server/ratelimit";

export const GET = route(async () => {
  const player = await requirePlayer();
  return NextResponse.json({ groups: await listMyGroups(player.id) });
});

const Body = z.object({ adjective: z.string().max(32), noun: z.string().max(32) });

export const POST = route(async (req: Request) => {
  const player = await requirePlayer();
  await rateLimit(`group-create:${player.id}`, 5, 3600);
  const body = Body.parse(await readJson(req));
  return NextResponse.json({ group: await createGroup(player.id, body.adjective, body.noun) });
});

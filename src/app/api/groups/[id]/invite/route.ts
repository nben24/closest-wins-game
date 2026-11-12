import { NextResponse } from "next/server";
import { ApiError, route } from "@/lib/server/errors";
import { rotateInvite } from "@/lib/server/groups";
import { requirePlayer } from "@/lib/server/players";
import { rateLimit } from "@/lib/server/ratelimit";

export const POST = route(async (_req: Request, ctx: RouteContext<"/api/groups/[id]/invite">) => {
  const player = await requirePlayer();
  await rateLimit(`invite-rotate:${player.id}`, 10, 3600);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "not_found", "Group wasn't found.");
  return NextResponse.json({ inviteCode: await rotateInvite(player.id, id) });
});

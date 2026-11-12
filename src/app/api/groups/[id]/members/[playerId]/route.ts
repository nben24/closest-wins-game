import { NextResponse } from "next/server";
import { ApiError, route } from "@/lib/server/errors";
import { removeMember } from "@/lib/server/groups";
import { requirePlayer } from "@/lib/server/players";

export const DELETE = route(async (_req: Request, ctx: RouteContext<"/api/groups/[id]/members/[playerId]">) => {
  const player = await requirePlayer();
  const { id, playerId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(playerId)) throw new ApiError(404, "not_found", "Not found.");
  await removeMember(player.id, id, playerId);
  return NextResponse.json({ ok: true });
});

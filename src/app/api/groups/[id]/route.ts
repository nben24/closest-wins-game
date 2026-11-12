import { NextResponse } from "next/server";
import { ApiError, route } from "@/lib/server/errors";
import { groupDetail, leaveGroup } from "@/lib/server/groups";
import { requirePlayer } from "@/lib/server/players";
import { today } from "@/lib/server/challenges";
import { isGameDate } from "@/lib/time";

const UUID = /^[0-9a-f-]{36}$/i;

export const GET = route(async (req: Request, ctx: RouteContext<"/api/groups/[id]">) => {
  const player = await requirePlayer();
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError(404, "not_found", "Group wasn't found.");
  const date = new URL(req.url).searchParams.get("date") ?? today();
  if (!isGameDate(date) || date > today()) throw new ApiError(400, "invalid_date", "Invalid date.");
  return NextResponse.json({ group: await groupDetail(player.id, id, date) }, { headers: { "Cache-Control": "no-store" } });
});

export const DELETE = route(async (_req: Request, ctx: RouteContext<"/api/groups/[id]">) => {
  const player = await requirePlayer();
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new ApiError(404, "not_found", "Group wasn't found.");
  await leaveGroup(player.id, id);
  return NextResponse.json({ ok: true });
});

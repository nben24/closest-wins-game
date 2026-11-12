import { NextResponse } from "next/server";
import { ApiError, route } from "@/lib/server/errors";
import { requireAdmin } from "@/lib/server/admin/auth";
import { advanceJob } from "@/lib/server/ai/pipeline";

export const maxDuration = 120;

/** Called repeatedly by the admin job page while it is open. Each call does ~one bounded step batch. */
export const POST = route(async (_req: Request, ctx: RouteContext<"/api/admin/jobs/[id]/advance">) => {
  await requireAdmin();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "not_found", "Not found.");
  const job = await advanceJob(id, 30_000);
  return NextResponse.json({ status: job?.status ?? null });
});

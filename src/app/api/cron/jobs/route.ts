import { NextResponse } from "next/server";
import { route } from "@/lib/server/errors";
import { requireCron } from "@/lib/server/cron-auth";
import { runJobWorker } from "@/lib/server/automation";

export const maxDuration = 300;

/** Optional: call more often (e.g. from an external scheduler) to finish generation jobs faster. */
export const GET = route(async (req: Request) => {
  requireCron(req);
  return NextResponse.json({ ok: true, advanced: await runJobWorker(240_000) });
});

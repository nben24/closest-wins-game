import { NextResponse } from "next/server";
import { route } from "@/lib/server/errors";
import { requireCron } from "@/lib/server/cron-auth";
import { runDailyMaintenance } from "@/lib/server/automation";

export const maxDuration = 300;

export const GET = route(async (req: Request) => {
  requireCron(req);
  return NextResponse.json({ ok: true, ...(await runDailyMaintenance(240_000)) });
});

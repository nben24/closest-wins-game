import "server-only";
import crypto from "node:crypto";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/server/errors";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export function requireCron(req: Request): void {
  const secret = env.cronSecret;
  if (!secret) throw new ApiError(503, "not_configured", "CRON_SECRET is not configured.");
  const got = req.headers.get("authorization") ?? "";
  const a = crypto.createHash("sha256").update(got).digest();
  const b = crypto.createHash("sha256").update(`Bearer ${secret}`).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new ApiError(401, "unauthorized", "Unauthorized.");
}

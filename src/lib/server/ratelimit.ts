import "server-only";
import crypto from "node:crypto";
import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { now } from "@/lib/server/clock";
import { ApiError } from "@/lib/server/errors";

/**
 * Fixed-window rate limiting stored in Postgres, so it works across serverless
 * instances. Buckets contain player ids or a salted hash of the client IP —
 * never a raw IP address.
 */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number): Promise<void> {
  const db = await getDb();
  const t = now().getTime();
  const windowStart = new Date(Math.floor(t / (windowSeconds * 1000)) * windowSeconds * 1000);
  const row = await db.one<{ count: number }>(
    `insert into rate_limits (bucket, window_start, count) values ($1, $2, 1)
     on conflict (bucket, window_start) do update set count = rate_limits.count + 1
     returning count`,
    [bucket, windowStart],
  );
  if ((row?.count ?? 0) > limit) {
    throw new ApiError(429, "rate_limited", "That's a lot of requests — please wait a moment and try again.");
  }
}

export async function clientIpHash(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return crypto.createHmac("sha256", env.localSessionSecret + (env.cronSecret ?? "")).update(ip).digest("hex").slice(0, 16);
}

export async function pruneRateLimits(): Promise<void> {
  const db = await getDb();
  await db.query("delete from rate_limits where window_start < $1", [new Date(now().getTime() - 2 * 86_400_000)]);
}

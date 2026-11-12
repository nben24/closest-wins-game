import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ConfigError } from "@/lib/env";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new ApiError(401, "unauthorized", "Please start a session first.");
export const forbidden = () => new ApiError(403, "forbidden", "You don't have access to that.");
export const notFound = (what = "That") => new ApiError(404, "not_found", `${what} wasn't found.`);

/** Wrap a route handler: typed errors become JSON, unknown errors are logged minimally. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json({ error: { code: "invalid_request", message: "Invalid request." } }, { status: 400 });
  }
  if (e instanceof ConfigError) {
    return NextResponse.json({ error: { code: "not_configured", message: e.message } }, { status: 503 });
  }
  // Log the error type and message only — never request bodies or credentials.
  console.error("[api] unexpected error:", e instanceof Error ? `${e.name}: ${e.message}` : "unknown");
  return NextResponse.json({ error: { code: "server_error", message: "Something went wrong. Please try again." } }, { status: 500 });
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 20_000) throw new ApiError(413, "too_large", "Request too large.");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Invalid request.");
  }
}

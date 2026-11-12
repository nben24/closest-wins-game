"use client";

export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      credentials: "same-origin",
      signal: init?.signal,
    });
  } catch {
    throw new ApiClientError(0, "network", "Can't reach the server. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } }).error;
    throw new ApiClientError(res.status, err?.code ?? "error", err?.message ?? "Something went wrong.");
  }
  return data as T;
}

/**
 * Estimate (server time − client time) from one request, NTP-style: assume
 * the server stamped its time halfway through the round trip.
 */
export function clockOffset(serverNowIso: string, sentAt: number, receivedAt: number): number {
  return new Date(serverNowIso).getTime() - (sentAt + receivedAt) / 2;
}

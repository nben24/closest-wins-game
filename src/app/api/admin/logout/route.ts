import { NextResponse } from "next/server";
import { route } from "@/lib/server/errors";
import { clearLocalAdminCookie } from "@/lib/server/identity";

export const POST = route(async () => {
  await clearLocalAdminCookie();
  return NextResponse.json({ ok: true });
});

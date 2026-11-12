import { NextResponse } from "next/server";
import { ApiError, route } from "@/lib/server/errors";
import { normalizeInviteCode, previewInvite } from "@/lib/server/groups";
import { getIdentity } from "@/lib/server/identity";
import { clientIpHash, rateLimit } from "@/lib/server/ratelimit";

/** Invite preview: only the group label and member count — never member names or scores. */
export const GET = route(async (_req: Request, ctx: RouteContext<"/api/invites/[code]">) => {
  const identity = await getIdentity();
  await rateLimit(`invite-preview:${identity?.authUserId ?? (await clientIpHash())}`, 30, 600);
  const code = normalizeInviteCode((await ctx.params).code);
  if (!code) throw new ApiError(404, "invalid_code", "That invite link isn't valid.");
  const g = await previewInvite(code);
  if (!g) throw new ApiError(404, "invalid_code", "That invite link isn't valid anymore.");
  return NextResponse.json({ group: { label: g.label, memberCount: g.memberCount } });
});

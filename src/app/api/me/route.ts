import { NextResponse } from "next/server";
import { appMode } from "@/lib/env";
import { route } from "@/lib/server/errors";
import { currentIdentityAndPlayer, touchPlayer } from "@/lib/server/players";

export const GET = route(async () => {
  const { identity, player } = await currentIdentityAndPlayer();
  if (player) await touchPlayer(player.id);
  return NextResponse.json({
    mode: appMode(),
    hasIdentity: Boolean(identity),
    isAnonymous: identity?.isAnonymous ?? true,
    player: player ? { id: player.id, name: player.name, avatarId: player.avatarId, adjective: player.adjective, noun: player.noun } : null,
  });
});

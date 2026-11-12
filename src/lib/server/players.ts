import "server-only";
import crypto from "node:crypto";
import { getDb, isUniqueViolation, type Sql } from "@/lib/db";
import { allowedSuffixes, formatNickname, isAvatarId, validateNickname } from "@/lib/names";
import { ApiError, unauthorized } from "@/lib/server/errors";
import { getIdentity, type Identity } from "@/lib/server/identity";

export interface Player {
  id: string;
  authUserId: string;
  avatarId: string;
  adjective: string;
  noun: string;
  suffix: number | null;
  name: string;
}

interface PlayerRow {
  id: string;
  auth_user_id: string;
  avatar_id: string;
  name_adjective: string;
  name_noun: string;
  name_suffix: number | null;
}

export function toPlayer(r: PlayerRow): Player {
  return {
    id: r.id,
    authUserId: r.auth_user_id,
    avatarId: r.avatar_id,
    adjective: r.name_adjective,
    noun: r.name_noun,
    suffix: r.name_suffix,
    name: formatNickname(r.name_adjective, r.name_noun, r.name_suffix),
  };
}

export async function findPlayerByAuth(authUserId: string, sql?: Sql): Promise<Player | null> {
  const db = sql ?? (await getDb());
  const r = await db.one<PlayerRow>("select * from players where auth_user_id = $1", [authUserId]);
  return r ? toPlayer(r) : null;
}

export async function currentIdentityAndPlayer(): Promise<{ identity: Identity | null; player: Player | null }> {
  const identity = await getIdentity();
  if (!identity) return { identity: null, player: null };
  return { identity, player: await findPlayerByAuth(identity.authUserId) };
}

/** Throws 401 when there's no session, 409 when the player hasn't chosen a profile. */
export async function requirePlayer(): Promise<Player> {
  const { identity, player } = await currentIdentityAndPlayer();
  if (!identity) throw unauthorized();
  if (!player) throw new ApiError(409, "no_profile", "Choose a nickname first.");
  return player;
}

/**
 * Create or update the caller's profile. The nickname is validated against the
 * approved lists; a numeric suffix is assigned only if the plain combination is
 * taken. The suffix is chosen at random from the allowed set.
 */
export async function saveProfile(identity: Identity, avatarId: unknown, adjective: unknown, noun: unknown): Promise<Player> {
  if (!isAvatarId(avatarId)) throw new ApiError(400, "invalid_avatar", "Pick an avatar from the list.");
  const nameError = validateNickname(adjective, noun);
  if (nameError) throw new ApiError(400, "invalid_name", nameError);
  const adj = adjective as string;
  const nn = noun as string;
  const db = await getDb();

  const existing = await findPlayerByAuth(identity.authUserId);
  if (existing && existing.adjective === adj && existing.noun === nn) {
    const r = await db.one<PlayerRow>(
      "update players set avatar_id = $2, last_seen_at = now() where id = $1 returning *",
      [existing.id, avatarId],
    );
    return toPlayer(r!);
  }

  const taken = new Set(
    (
      await db.query<{ name_suffix: number | null }>(
        "select name_suffix from players where name_adjective = $1 and name_noun = $2",
        [adj, nn],
      )
    ).map((r) => r.name_suffix ?? 0),
  );
  const candidates: (number | null)[] = [];
  if (!taken.has(0)) candidates.push(null);
  const free = allowedSuffixes().filter((s) => !taken.has(s));
  for (let i = free.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [free[i], free[j]] = [free[j], free[i]];
  }
  candidates.push(...free.slice(0, 5));
  if (candidates.length === 0) {
    throw new ApiError(409, "name_full", "That nickname is very popular today. Try a different combination.");
  }

  for (const suffix of candidates) {
    try {
      const r = existing
        ? await db.one<PlayerRow>(
            `update players set avatar_id = $2, name_adjective = $3, name_noun = $4, name_suffix = $5, last_seen_at = now()
             where id = $1 returning *`,
            [existing.id, avatarId, adj, nn, suffix],
          )
        : await db.one<PlayerRow>(
            `insert into players (auth_user_id, avatar_id, name_adjective, name_noun, name_suffix)
             values ($1, $2, $3, $4, $5) returning *`,
            [identity.authUserId, avatarId, adj, nn, suffix],
          );
      return toPlayer(r!);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // name collision (or a concurrent create for this auth user): try next
      const again = !existing ? await findPlayerByAuth(identity.authUserId) : null;
      if (again) return saveProfile(identity, avatarId, adjective, noun);
    }
  }
  throw new ApiError(409, "name_full", "That nickname is very popular today. Try a different combination.");
}

export async function touchPlayer(playerId: string): Promise<void> {
  const db = await getDb();
  await db.query("update players set last_seen_at = now() where id = $1 and last_seen_at < now() - interval '1 hour'", [playerId]);
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { formatNickname } from "@/lib/names";
import { devToolsAllowed } from "@/lib/server/dev";
import { getIdentity } from "@/lib/server/identity";
import { isGameDate } from "@/lib/time";
import { DevGuessesView } from "./view";

/**
 * LOCAL TESTING ONLY: preview "everyone's guesses" for any day, as any player
 * who finished it. 404s outside local development.
 */
export default async function DevGuessesPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  if (!devToolsAllowed()) notFound();
  const db = await getDb();
  const days = await db.query<{ d: string; number: number }>(
    "select to_char(challenge_date, 'YYYY-MM-DD') as d, number from daily_challenges where status = 'published' order by challenge_date desc",
  );
  const asked = (await searchParams).date;
  const date = asked && isGameDate(asked) ? asked : days[0]?.d;
  const players = date
    ? await db.query<{ id: string; auth_user_id: string; name_adjective: string; name_noun: string; name_suffix: number | null; total_score: number }>(
        `select p.id, p.auth_user_id, p.name_adjective, p.name_noun, p.name_suffix, a.total_score
           from attempts a join players p on p.id = a.player_id
           join daily_challenges dc on dc.id = a.challenge_id
          where dc.challenge_date = $1 and a.status = 'completed'
          order by a.total_score desc`,
        [date],
      )
    : [];
  const me = await getIdentity();
  const viewing = players.find((p) => p.auth_user_id === me?.authUserId);

  return (
    <DevGuessesView date={date ?? null} canView={Boolean(viewing)}>
      <div className="card space-y-3 p-4 text-base">
        <p className="label">Test preview · local only</p>
        <div className="flex flex-wrap gap-2">
          {days.map((d) => (
            <Link key={d.d} href={`/dev/guesses?date=${d.d}`} className={`rounded-lg px-2 py-1 text-sm font-bold ${d.d === date ? "bg-primary text-primary-fg" : "bg-paper ring-1 ring-line"}`}>
              #{d.number} · {d.d.slice(5)}
            </Link>
          ))}
        </div>
        <p>
          {viewing
            ? <>Viewing as <strong>{formatNickname(viewing.name_adjective, viewing.name_noun, viewing.name_suffix)}</strong>. Pick someone else:</>
            : <>Pick a player who finished this day to see it as them:</>}
        </p>
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {players.map((p) => (
            <a key={p.id} href={`/api/dev/act-as?player=${p.id}&date=${date}`} className={`rounded-lg px-2 py-1 text-sm ${p.id === viewing?.id ? "bg-sun-soft font-bold ring-2 ring-sun" : "bg-paper ring-1 ring-line"}`}>
              {formatNickname(p.name_adjective, p.name_noun, p.name_suffix)} · {p.total_score}
            </a>
          ))}
        </div>
      </div>
    </DevGuessesView>
  );
}

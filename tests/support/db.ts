import { createPgliteDb, setDbForTests, type Db } from "@/lib/db";
import { seedDemoQuestions } from "@/lib/db/seed";
import { setClockForTests } from "@/lib/server/clock";

export async function freshDb(seed = true): Promise<Db> {
  const db = await createPgliteDb("memory://");
  if (seed) await seedDemoQuestions(db);
  setDbForTests(db);
  return db;
}

let counter = 0;
const ADJ = ["Sunny", "Clever", "Brave", "Cozy", "Jolly", "Lucky", "Mighty", "Nimble"];
export async function makePlayer(db: Db): Promise<string> {
  counter++;
  const r = await db.one<{ id: string }>(
    `insert into players (auth_user_id, avatar_id, name_adjective, name_noun, name_suffix)
     values (gen_random_uuid(), 'otter', $1, 'Otter', $2) returning id`,
    [ADJ[counter % ADJ.length], (counter % 50) + 2],
  );
  return r!.id;
}

/** A controllable clock. */
export function fakeClock(startIso: string) {
  let t = new Date(startIso).getTime();
  setClockForTests(() => new Date(t));
  return {
    advance(ms: number) {
      t += ms;
    },
    set(iso: string) {
      t = new Date(iso).getTime();
    },
    get now() {
      return new Date(t);
    },
  };
}

export function resetClock() {
  setClockForTests(null);
}

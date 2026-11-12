import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { GAME_TITLE, TIMING } from "@/config/game";
import { scoreGuess } from "@/lib/scoring";

export const metadata: Metadata = { title: "How it works" };

const examples = [
  { label: "Exactly right", points: 1000 },
  { label: "Off by 10%", points: scoreGuess({ type: "ratio", tolerance: 1.5 }, 100, 110) },
  { label: "Off by 25%", points: scoreGuess({ type: "ratio", tolerance: 1.5 }, 100, 125) },
  { label: "Off by half (×1.5)", points: scoreGuess({ type: "ratio", tolerance: 1.5 }, 100, 150) },
  { label: "Double", points: scoreGuess({ type: "ratio", tolerance: 1.5 }, 100, 200) },
  { label: "Five times", points: scoreGuess({ type: "ratio", tolerance: 1.5 }, 100, 500) },
];

export default function AboutPage() {
  return (
    <Shell>
      <article className="space-y-5 text-lg leading-relaxed">
        <h1 className="font-display text-3xl font-extrabold">How {GAME_TITLE} works</h1>
        <section className="card space-y-2 p-5">
          <h2 className="font-display text-xl font-extrabold">Every day</h2>
          <p>Everyone gets the same five questions. A new set starts at midnight Eastern Time.</p>
          <p>
            For each one you get {TIMING.readingMs / 1000} seconds to read, then {TIMING.answerMs / 1000} seconds to enter a number. If time runs out,
            whatever you&apos;ve typed is submitted automatically.
          </p>
        </section>
        <section className="card space-y-3 p-5">
          <h2 className="font-display text-xl font-extrabold">Scoring</h2>
          <p>Up to 1,000 points per question, 5,000 per day. Only accuracy counts — answering faster earns nothing extra.</p>
          <p>Points shrink smoothly the further off you are. For most questions what matters is how many <em>times</em> too high or low you were:</p>
          <table className="w-full text-base">
            <tbody>
              {examples.map((e) => (
                <tr key={e.label} className="border-b border-line last:border-0">
                  <td className="py-1.5">{e.label}</td>
                  <td className="py-1.5 text-right font-bold tabular-nums">{e.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-base text-ink-soft">
            Year questions count years off (so 2000 vs 2010 is a real miss). Percentage questions count percentage points. Each question has its own
            tolerance, locked when the day&apos;s challenge is published so everyone is judged the same way.
          </p>
          <p className="text-base text-ink-soft">Ties share a rank — nobody wins by typing faster.</p>
        </section>
        <section className="card space-y-2 p-5">
          <h2 className="font-display text-xl font-extrabold">Groups</h2>
          <p>Groups are private and invite-only. You only see other players&apos; guesses after you finish that day yourself.</p>
          <p>Weekly standings run Monday to Sunday and add up your best five days.</p>
        </section>
        <section className="card space-y-2 p-5">
          <h2 className="font-display text-xl font-extrabold">Privacy</h2>
          <p>No email, password, birthday or location. You pick an avatar and a nickname from friendly word lists.</p>
          <p>Your guest account lives in this browser. Clearing site data or switching devices starts a new player.</p>
        </section>
        <section className="card space-y-2 p-5">
          <h2 className="font-display text-xl font-extrabold">Fair play</h2>
          <p className="text-base">
            The server keeps the clock: refreshing or opening a second tab doesn&apos;t restart a question, and each answer counts once. We allow a short
            network allowance ({TIMING.submitGraceMs / 1000}s) after the timer so slow connections aren&apos;t penalized. It&apos;s a casual game — a determined
            person could still look things up or make a new guest account, so play for fun!
          </p>
        </section>
        <p><Link href="/" className="btn-primary w-full">Back to today</Link></p>
      </article>
    </Shell>
  );
}

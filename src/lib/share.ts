import { GAME_TITLE, MAX_POINTS_PER_DAY } from "@/config/game";
import { formatPoints } from "@/lib/format";
import { scoreBand } from "@/lib/scoring";
import { formatGameDate } from "@/lib/time";

export interface ShareRound {
  points: number;
  answered: boolean;
  voided: boolean;
}

/** Spoiler-free share text: no prompts, guesses or answers. */
export function buildShareText(opts: {
  number: number;
  date: string;
  total: number;
  maxTotal?: number;
  rounds: ShareRound[];
  url: string;
  title?: string;
}): string {
  const symbols = opts.rounds.map((r) => scoreBand(r.points, r.answered, r.voided).shareSymbol).join("");
  const max = opts.maxTotal ?? MAX_POINTS_PER_DAY;
  return [
    `${opts.title ?? GAME_TITLE} #${opts.number} · ${formatGameDate(opts.date)}`,
    `${formatPoints(opts.total)} / ${formatPoints(max)}`,
    symbols,
    opts.url,
  ].join("\n");
}

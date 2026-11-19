"use client";

import type { ReactNode } from "react";
import { EveryoneGuesses } from "@/components/EveryoneGuesses";
import { Shell } from "@/components/Shell";

export function DevGuessesView({ date, canView, children }: { date: string | null; canView: boolean; children: ReactNode }) {
  return (
    <Shell>
      <div className="space-y-5">
        {children}
        {date && canView && <EveryoneGuesses key={date} date={date} />}
      </div>
    </Shell>
  );
}

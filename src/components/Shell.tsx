"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/Logo";
import { Avatar } from "@/components/Avatar";
import { CREATOR } from "@/config/game";
import { useSession } from "@/lib/client/session";

const NAV = [
  { href: "/", label: "Today" },
  { href: "/leaderboard", label: "Ranks" },
  { href: "/groups", label: "Groups" },
  { href: "/history", label: "History" },
];

export function Shell({ children, wide = false, hideNav = false, compact = false }: { children: ReactNode; wide?: boolean; hideNav?: boolean; compact?: boolean }) {
  const pathname = usePathname();
  const { me } = useSession();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className={`sticky top-0 z-20 ${compact ? "[@media(max-height:620px)]:hidden" : ""} border-b border-line/70 bg-paper/90 backdrop-blur pt-[env(safe-area-inset-top)]`}>
        <div className={`mx-auto flex ${compact ? "h-12" : "h-16"} items-center justify-between gap-3 px-4 ${wide ? "max-w-5xl" : "max-w-xl"}`}>
          <Link href="/" className="rounded-xl" aria-label="Home">
            <Wordmark />
          </Link>
          {me && (
            <Link href="/profile" className="flex items-center gap-2 rounded-full p-1" aria-label={`Your profile: ${me.name}`}>
              <Avatar id={me.avatarId} size="sm" label="" />
            </Link>
          )}
        </div>
        {!hideNav && !compact && me && (
          <nav aria-label="Main" className={`mx-auto flex gap-1 px-3 pb-2 ${wide ? "max-w-5xl" : "max-w-xl"}`}>
            {NAV.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={`min-h-11 flex-1 rounded-xl px-1 py-2 text-center text-base font-bold ${
                    active ? "bg-primary text-primary-fg" : "text-ink-soft hover:bg-card"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        )}
      </header>
      <main className={`mx-auto w-full flex-1 px-4 ${compact ? "pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]" : "pt-5 pb-6"} ${wide ? "max-w-5xl" : "max-w-xl"}`}>
        {children}
      </main>
      {!compact && (
        <footer className="pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-center text-sm text-ink-soft">
          made by{" "}
          <a href={CREATOR.profileUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-ink underline-offset-2 hover:underline">
            @{CREATOR.handle}
          </a>
          {" · "}
          <a href={CREATOR.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
            source code on GitHub
          </a>
        </footer>
      )}
    </div>
  );
}

export function CenterMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card mt-6 p-6 text-center">
      <h1 className="font-display text-2xl font-extrabold">{title}</h1>
      {children && <div className="mt-3 text-lg text-ink-soft">{children}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex justify-center py-16" role="status" aria-live="polite">
      <span className="h-10 w-10 animate-spin rounded-full border-4 border-line border-t-coral motion-reduce:animate-none" aria-hidden="true" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

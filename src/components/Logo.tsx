import { GAME_TITLE } from "@/config/game";

export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#2a1f3d" />
      <path d="M10 44h44" stroke="#fff6e9" strokeWidth="4" strokeLinecap="round" />
      <path d="M18 40v8M32 40v8M46 40v8" stroke="#fff6e9" strokeWidth="3" strokeLinecap="round" />
      <path d="M38 12 32 38" stroke="#ffc94a" strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="40" r="5" fill="#d23f1b" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="font-display text-xl font-extrabold tracking-tight">{GAME_TITLE}</span>
    </span>
  );
}

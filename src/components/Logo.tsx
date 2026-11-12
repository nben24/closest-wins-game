import { GAME_TITLE } from "@/config/game";

export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="#ff3d7f" />
      <path d="M10 44h44" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
      <path d="M18 40v8M32 40v8M46 40v8" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
      <path d="M38 12 32 38" stroke="#ffd23f" strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="40" r="5" fill="#12153d" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="wordmark title font-display text-xl font-extrabold tracking-tight">{GAME_TITLE}</span>
    </span>
  );
}

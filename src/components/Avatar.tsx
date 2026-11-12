import { avatarById } from "@/lib/names";

export function Avatar({ id, size = "md", label }: { id: string; size?: "sm" | "md" | "lg" | "xl"; label?: string }) {
  const a = avatarById(id);
  const cls = { sm: "h-8 w-8 text-lg", md: "h-11 w-11 text-2xl", lg: "h-16 w-16 text-4xl", xl: "h-24 w-24 text-6xl" }[size];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full ring-2 ring-white ${cls}`}
      style={{ background: a.bg }}
      role="img"
      aria-label={label ?? a.label}
    >
      <span aria-hidden="true">{a.emoji}</span>
    </span>
  );
}

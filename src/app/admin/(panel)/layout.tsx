import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { GAME_TITLE } from "@/config/game";
import { requireAdminPage } from "@/lib/server/admin/auth";
import { SignOutButton } from "@/components/admin/SignOut";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

const NAV = [
  ["/admin", "Dashboard"],
  ["/admin/questions", "Questions"],
  ["/admin/generate", "Generate"],
  ["/admin/schedule", "Schedule"],
  ["/admin/settings", "Settings"],
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdminPage();
  return (
    <div className="min-h-dvh text-base">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2 font-display text-lg font-extrabold">
            <LogoMark className="h-7 w-7" /> {GAME_TITLE} admin
          </Link>
          <nav className="flex flex-wrap gap-1" aria-label="Admin">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="rounded-lg px-3 py-1.5 font-semibold text-ink-soft hover:bg-paper hover:text-ink">
                {label}
              </Link>
            ))}
          </nav>
          <span className="ml-auto flex items-center gap-3 text-sm text-ink-soft">
            {admin.email}
            <SignOutButton />
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

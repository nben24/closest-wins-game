import type { Viewport } from "next";
import { SessionProvider } from "@/lib/client/session";

export const viewport: Viewport = { themeColor: "#12153d" };

/** Player screens use the "Game-show night" theme (see globals.css). */
export default function GameLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="theme-gameshow">
      <SessionProvider>{children}</SessionProvider>
    </div>
  );
}

import type { Metadata, Viewport } from "next";
import { Anton, Bricolage_Grotesque, Figtree, Nunito } from "next/font/google";
import { GAME_TAGLINE, GAME_TITLE } from "@/config/game";
import "./globals.css";

const display = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], weight: ["600", "700", "800"] });
const body = Figtree({ variable: "--font-figtree", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
// Player theme ("Game-show night")
const anton = Anton({ variable: "--font-anton", subsets: ["latin"], weight: "400" });
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], weight: ["400", "600", "700", "800", "900"] });

/** Absolute base URL for link previews: explicit setting, else Vercel's production domain. */
function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return new URL(explicit);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return new URL(`https://${vercel}`);
  return new URL("http://localhost:3000");
}

const DESCRIPTION = "Everyone gets the same 5 number questions every day. Closest guess wins — with a daily leaderboard.";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: GAME_TITLE, template: `%s · ${GAME_TITLE}` },
  description: DESCRIPTION,
  applicationName: GAME_TITLE,
  robots: { index: true, follow: false },
  openGraph: { type: "website", siteName: GAME_TITLE, title: `${GAME_TITLE} — ${GAME_TAGLINE}`, description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: `${GAME_TITLE} — ${GAME_TAGLINE}`, description: DESCRIPTION },
  appleWebApp: { capable: true, title: GAME_TITLE, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fff6e9",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${anton.variable} ${nunito.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

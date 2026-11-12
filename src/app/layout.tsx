import type { Metadata, Viewport } from "next";
import { Anton, Bricolage_Grotesque, Figtree, Nunito } from "next/font/google";
import { GAME_TAGLINE, GAME_TITLE } from "@/config/game";
import "./globals.css";

const display = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], weight: ["600", "700", "800"] });
const body = Figtree({ variable: "--font-figtree", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
// Player theme ("Game-show night")
const anton = Anton({ variable: "--font-anton", subsets: ["latin"], weight: "400" });
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], weight: ["400", "600", "700", "800", "900"] });

export const metadata: Metadata = {
  title: { default: GAME_TITLE, template: `%s · ${GAME_TITLE}` },
  description: `${GAME_TAGLINE} A daily estimation game for friends and families.`,
  applicationName: GAME_TITLE,
  robots: { index: true, follow: false },
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

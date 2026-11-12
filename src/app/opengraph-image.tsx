import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { GAME_TITLE } from "@/config/game";

/** Link preview image (iMessage, WhatsApp, Slack, social). */
export const alt = `${GAME_TITLE} — five number questions a day, closest guess wins`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NAVY = "#12153d";
const CARD = "#1d2260";
const YELLOW = "#ffd23f";
const PINK = "#ff3d7f";
const TEAL = "#3ddbd9";

function Mark({ px }: { px: number }) {
  return (
    <svg width={px} height={px} viewBox="0 0 64 64">
      <rect width="64" height="64" rx="18" fill={PINK} />
      <path d="M10 44h44" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path d="M18 40v8M32 40v8M46 40v8" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M38 12 32 38" stroke={YELLOW} strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="40" r="5" fill={NAVY} />
    </svg>
  );
}

export default async function Image() {
  const anton = await readFile(join(process.cwd(), "assets/fonts/Anton-Regular.ttf"));
  const tiles = [
    { c: YELLOW, t: "1000" },
    { c: TEAL, t: "812" },
    { c: PINK, t: "640" },
    { c: TEAL, t: "905" },
    { c: YELLOW, t: "988" },
  ];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: `radial-gradient(circle at 30% -10%, #2b3190 0%, ${NAVY} 60%)`,
          fontFamily: "Anton",
          color: "#fff",
          padding: "64px 72px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <Mark px={120} />
            <div style={{ fontSize: 112, color: YELLOW, letterSpacing: 2, lineHeight: 1 }}>{GAME_TITLE.toUpperCase()}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 64, lineHeight: 1.05 }}>5 QUESTIONS A DAY.</div>
            <div style={{ fontSize: 64, lineHeight: 1.05, color: PINK }}>CLOSEST GUESS WINS.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {tiles.map((t, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 120,
                  height: 72,
                  borderRadius: 16,
                  background: CARD,
                  border: `4px solid ${t.c}`,
                  color: t.c,
                  fontSize: 40,
                }}
              >
                {t.t}
              </div>
            ))}
            <div style={{ display: "flex", marginLeft: 20, fontSize: 40, color: "#c3c7ef" }}>DAILY LEADERBOARD</div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Anton", data: anton, style: "normal", weight: 400 }] },
  );
}

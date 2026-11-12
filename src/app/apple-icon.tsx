import { ImageResponse } from "next/og";

/** iPhone home-screen icon (Add to Home Screen). */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ff3d7f" }}>
        <svg width="180" height="180" viewBox="0 0 64 64">
          <rect width="64" height="64" fill="#ff3d7f" />
          <path d="M10 44h44" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
          <path d="M18 40v8M32 40v8M46 40v8" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          <path d="M38 12 32 38" stroke="#ffd23f" strokeWidth="5" strokeLinecap="round" />
          <circle cx="32" cy="40" r="5" fill="#12153d" />
        </svg>
      </div>
    ),
    size,
  );
}

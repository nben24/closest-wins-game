import type { MetadataRoute } from "next";
import { GAME_TAGLINE, GAME_TITLE } from "@/config/game";

/** Lets players "Add to Home Screen" and open the game like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: GAME_TITLE,
    short_name: GAME_TITLE,
    description: GAME_TAGLINE,
    start_url: "/",
    display: "standalone",
    background_color: "#12153d",
    theme_color: "#12153d",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}

import type { NextConfig } from "next";

// Every screen in this app is per-player and dynamic, so Cache Components is
// intentionally left off; data is always read at request time.
const nextConfig: NextConfig = {
  // Database drivers must run as regular Node modules, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  // The link-preview image reads its font from disk at build/run time.
  outputFileTracingIncludes: { "/opengraph-image": ["./assets/fonts/**"], "/twitter-image": ["./assets/fonts/**"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

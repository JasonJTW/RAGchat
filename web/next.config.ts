import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // E2E runs its own `next dev` beside the developer's; separate build dirs
  // keep the two from sharing (and locking) one .next folder.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The browser only talks to :3000; /api/* goes to the Express server, so
  // its cookies are same-origin.
  async rewrites() {
    const server = process.env.SERVER_URL ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${server}/api/:path*` }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // npm workspaces hoist deps to the repo root
    root: path.join(__dirname, ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

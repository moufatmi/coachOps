import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack's project root. Without this it walks up past the repo and
  // trips over files outside it (e.g. a stray package-lock.json in the home
  // directory), which it then refuses to use.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
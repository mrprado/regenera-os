import type { NextConfig } from "next";

// The OS is served at regenera.bio/os: a Cloudflare Worker route in front of the public site (docs/DEPLOY.md).
const nextConfig: NextConfig = {
  basePath: "/os",
};

export default nextConfig;

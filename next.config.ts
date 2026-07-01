import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the file-tracing root to THIS project. A stray lockfile in a parent
  // directory can otherwise make Next infer the wrong workspace root, which
  // breaks output tracing on Vercel. Server Actions and RSC are on by default;
  // kept otherwise minimal (the "no over-abstraction" goal).
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Import sends parsed transactions (not the raw file) to a server action;
    // a few thousand rows can exceed the 1 MB default.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;

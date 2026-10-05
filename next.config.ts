import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // kuromoji loads its ~18MB dictionary from node_modules at runtime;
  // keep it out of the server bundle.
  serverExternalPackages: ["kuromoji"],
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;

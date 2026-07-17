import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // kuromoji loads its ~18MB dictionary from node_modules at runtime;
  // keep it out of the server bundle.
  serverExternalPackages: ["kuromoji"],
};

export default nextConfig;

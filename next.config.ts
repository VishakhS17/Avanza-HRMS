import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    serverActions: {
      // Document uploads are capped at 4 MB in the service. This leaves room for the multipart
      // overhead and stays under Vercel's 4.5 MB request body limit.
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;

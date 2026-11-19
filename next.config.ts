import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: [
    // pdfjs-dist resolves its worker via runtime dynamic import — bundling
    // it into the server build breaks that resolution ("Setting up fake
    // worker failed"). Keeping it external restores plain Node resolution.
    "pdfjs-dist",
  ],
};

export default nextConfig;

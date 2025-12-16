import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Ensure native canvas binding is bundled for pdfjs in standalone/serverless output
  serverExternalPackages: ["@napi-rs/canvas"],
};

export default nextConfig;

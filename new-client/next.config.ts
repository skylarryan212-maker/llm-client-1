import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Alias @napi-rs/canvas to a lightweight stub to silence pdfjs warnings in Lambda/edge
      config.resolve.alias["@napi-rs/canvas"] = path.resolve(__dirname, "lib/extraction/canvasStub.js");
    }
    return config;
  },
};

export default nextConfig;

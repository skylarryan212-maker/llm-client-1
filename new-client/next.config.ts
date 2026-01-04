import type { NextConfig } from "next";
import path from "path";

const canvasStubPath = path.resolve(__dirname, "lib/extraction/canvasStub.js");

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Keep file tracing root aligned with `turbopack.root` to avoid Next.js warnings on Vercel.
  outputFileTracingRoot: __dirname,
  // Turbopack is default in Next 16; mirror the webpack alias so builds on Vercel do not fail.
  turbopack: {
    // Explicitly pin the workspace root to this package to avoid picking the parent lockfile.
    root: __dirname,
    resolveAlias: {
      "@napi-rs/canvas": canvasStubPath,
    },
  },
  outputFileTracingIncludes: {
    "/api/web-render": ["./node_modules/@sparticuz/chromium/**"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Alias @napi-rs/canvas to a lightweight stub to silence pdfjs warnings in Lambda/edge
      config.resolve.alias["@napi-rs/canvas"] = canvasStubPath;
    }
    return config;
  },
};

export default nextConfig;

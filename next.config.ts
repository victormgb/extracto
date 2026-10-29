import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // pdfjs-dist y @napi-rs/canvas (nativo) se cargan con require de Node en runtime
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

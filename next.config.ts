import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only "N" button: keep it out of the sidebar footer.
  devIndicators: { position: "bottom-right" },
  // The Kubernetes client uses Node-only APIs; keep it out of the bundle.
  serverExternalPackages: ["@kubernetes/client-node"],
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

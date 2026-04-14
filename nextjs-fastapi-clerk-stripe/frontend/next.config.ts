import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_INTERNAL_URL;

const nextConfig: NextConfig = {
  output: "standalone",
  ...(backendUrl
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${backendUrl}/api/:path*`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";
const nextConfig = {
  output: isDev ? undefined : "export",
  images: { unoptimized: true },
  trailingSlash: false,
  async rewrites() {
    if (!isDev) return [];
    return [{ source: "/api/:path*", destination: "http://localhost:8080/api/:path*" }];
  },
};
module.exports = nextConfig;

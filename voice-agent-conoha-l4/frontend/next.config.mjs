/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/offer", destination: "http://agent:8080/offer" },
      { source: "/api/orders/:path*", destination: "http://backend:8000/api/orders/:path*" },
      { source: "/api/events", destination: "http://backend:8000/api/events" },
    ];
  },
};
export default nextConfig;

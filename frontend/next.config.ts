import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Presentation jobs use multipart uploads (templates + source files). Keep
  // this above the backend's 125MB aggregate asset limit so proxy framing
  // never turns a valid upload into a browser-side fetch failure.
  experimental: {
    proxyClientMaxBodySize: "140mb",
    // A large PPTX can take longer than Next's 30s proxy default to upload
    // over a remote connection. Keep the request alive while the backend
    // streams the file to disk and validates the archive.
    proxyTimeout: 300000
  },
  images: {
    qualities: [75, 88]
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_API_URL ?? "http://localhost:8008";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`
      }
    ];
  }
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/games/:gameId',
        destination: '/betting/games/:gameId',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

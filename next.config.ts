import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    qualities: [75, 95],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.nba.com',
        pathname: '/headshots/**',
      },
    ],
  },
  async redirects() {
    return [
      {
        source: '/games/:gameId',
        destination: '/betting/games/:gameId',
        permanent: true,
      },
      {
        source: '/betting',
        destination: '/dashboard',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

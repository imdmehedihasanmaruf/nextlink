/** @type {import('next').NextConfig} */

// The Express API (Backend Engine) listens on http://localhost:3000 in this
// workspace. Requests to /api/* that do not resolve to a Next.js route in this
// admin app are proxied to it. Next.js' filesystem routes always win.
const expressApi = (process.env.INTERNAL_API_URL || 'http://localhost:3000').replace(/\/$/, '');

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${expressApi}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;

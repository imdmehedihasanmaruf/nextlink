/** @type {import('next').NextConfig} */

// The Express API (Backend Engine) listens on http://localhost:3000 in this
// workspace. Requests to /api/* that do not resolve to a Next.js route in this
// app are proxied to it. Next.js' filesystem routes always win, so the portal's
// own API routes (/api/customer/*, /api/auth/customer-login, ...) are served
// by this app; everything else is the Express backend.
const expressApi = (process.env.INTERNAL_API_URL || 'http://localhost:3000').replace(/\/$/, '');

const nextConfig = {
  images: {
    domains: ['placeholder.com', 'via.placeholder.com'],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${expressApi}/api/:path*`,
      },
    ];
  },
}

module.exports = nextConfig

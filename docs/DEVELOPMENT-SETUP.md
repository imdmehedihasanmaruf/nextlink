# Development Setup

## Prerequisites

### Frontend requirements (Phase 1)
- Node.js 20.9 or later (required by Next.js 16)
- npm

### Required PHP Extensions
- bcmath
- ctype
- curl
- dom
- fileinfo
- mbstring
- openssl
- pdo
- tokenizer
- xml
- pdo_pgsql
- pgsql

## Frontend Setup

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Start Development Server
```bash
npm run dev
# Open the URL printed by Next.js, normally http://localhost:3000
```

Next.js is the application server. The earlier directory listing occurred because a static file server was serving the repository root, not the Next.js App Router. Do not serve the repository directory with a static listing server, and do not expect port 5500 to host the app. If port 3000 is busy, Next.js reports the alternate port it selected.

To verify and run the production build:

```bash
cd frontend
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

## Laravel backend foundation

Use PHP 8.2+ and Composer from the existing `backend/` directory. Copy `.env.example` to `.env` only when a local configuration does not already exist; review database settings before use. The existing checked-in local environment and database were not altered. Sanctum is used for bearer-token API authentication. Set `CORS_ALLOWED_ORIGINS` to the exact Next.js origin and configure `DB_CONNECTION=pgsql` plus database credentials in the local backend `.env` for PostgreSQL. Do not run migrations against production or a shared database without a verified backup and explicit approval.

```bash
cd backend
composer install
php artisan key:generate
php artisan migrate
php artisan serve --host=127.0.0.1 --port=8000
```

The V1 API is served at `http://127.0.0.1:8000/api/v1`. Configure the frontend with `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api`; the API client appends `/v1`. The admin login and several API services are live; other portal workflows may still use demo UI. A configured API base URL is mandatory outside development; the client fails closed if it is missing.

## Demo and future backend

Most portal screens use fictional sample data. Mock status changes and simulated login do not call a service or enforce authorization. The Laravel API provides Sanctum authentication, authorization checks and database operations for implemented routes, but this does not make demo screens secure. Payment endpoints only create pending/manual records; they do not contact a payment provider. SMS and live MikroTik operations are not implemented. Do not use real credentials or sensitive identity data in demo screens.

The administrator screen illustrates Super Admin, Accounts/Billing, Support/Helpdesk and Field Technician roles; the subscriber/client portal is a separate demonstration area. The technician work queue is available at `/technician`. These role labels are for UI demonstration and do not provide access control.

## Production deployment gate

This repository is not production-ready for live ISP operations. Before deployment, provide a generated `APP_KEY`, `APP_DEBUG=false`, production PostgreSQL credentials, HTTPS URLs, exact `CORS_ALLOWED_ORIGINS`, secure mail/queue/cache/storage configuration, and `NEXT_PUBLIC_API_BASE_URL`. Never use example SQLite/local/log settings as production configuration. Verify backups, migrations, monitoring, rate limits and recovery procedures. The `disabled` MikroTik adapter is intentional: no live router action should be reported as successful until an implemented adapter is configured. Production payment processing requires a real provider integration, signed callback verification and idempotency.

### Split Vercel deployment

Deploy `frontend/` and `backend/` as separate Vercel projects from the same repository. Set the frontend project's Root Directory to `frontend` and its Production environment variable `NEXT_PUBLIC_API_BASE_URL` to `https://nextlink-backend.vercel.app/api`. Set the backend project's Root Directory to `backend`, Framework Preset to `Other`, and Build Command override to empty; Laravel's PHP function does not need the backend Vite build. The backend `vercel.json` routes requests to its PHP function, and `backend/api/index.php` places Laravel's writable runtime storage under `/tmp`.

Set these backend Production environment variables in Vercel: `APP_ENV=production`, `APP_DEBUG=false`, `APP_KEY` (generate a unique Laravel key and store it as a secret), `APP_URL=https://nextlink-backend.vercel.app`, `DB_CONNECTION=pgsql`, `DB_HOST`, `DB_PORT=5432`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` (or a provider-supported `DB_URL`), and `CORS_ALLOWED_ORIGINS=https://nextlink-isp.vercel.app`. Use a persistent managed PostgreSQL database; do not use SQLite on Vercel. Use `LOG_CHANNEL=stderr`. For cache and rate limiting use a persistent cache store, preferably database or Redis; do not use the in-memory array cache for production login throttling. The API uses Sanctum bearer tokens, so `SANCTUM_STATEFUL_DOMAINS` is not required for the current browser login flow. Set third-party credentials only when those integrations are implemented and needed.

After setting backend variables, deploy the backend first and verify `/up` returns HTTP 200, `/api/v1/packages` returns JSON, `/api/v1/dashboard` returns 401 without a token, and an `OPTIONS` request from the frontend origin includes `Access-Control-Allow-Origin`. Then set the frontend variable and redeploy the frontend. Run database migrations against the managed production database from a controlled deployment process after taking a backup; never run destructive migrations against production without review.
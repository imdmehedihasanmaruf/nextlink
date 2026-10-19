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

The V1 API is served at `http://127.0.0.1:8000/api/v1`. Configure the frontend with `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api/v1`. The admin, client, technician and most public screens are still demo UI, not real API-backed workflows. A configured API base URL is mandatory outside development; the client fails closed if it is missing.

## Demo and future backend

Most portal screens use fictional sample data. Mock status changes and simulated login do not call a service or enforce authorization. The Laravel API provides Sanctum authentication, authorization checks and database operations for implemented routes, but this does not make demo screens secure. Payment endpoints only create pending/manual records; they do not contact a payment provider. SMS and live MikroTik operations are not implemented. Do not use real credentials or sensitive identity data in demo screens.

The administrator screen illustrates Super Admin, Accounts/Billing, Support/Helpdesk and Field Technician roles; the subscriber/client portal is a separate demonstration area. The technician work queue is available at `/technician`. These role labels are for UI demonstration and do not provide access control.

## Production deployment gate

This repository is not production-ready for live ISP operations. Before deployment, provide a generated `APP_KEY`, `APP_DEBUG=false`, production PostgreSQL credentials, HTTPS URLs, exact `CORS_ALLOWED_ORIGINS`, secure mail/queue/cache/storage configuration, and `NEXT_PUBLIC_API_BASE_URL`. Never use example SQLite/local/log settings as production configuration. Verify backups, migrations, monitoring, rate limits and recovery procedures. The `disabled` MikroTik adapter is intentional: no live router action should be reported as successful until an implemented adapter is configured. Production payment processing requires a real provider integration, signed callback verification and idempotency.
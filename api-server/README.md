# NextLink API — Backend Engine (Express)

REST API for the NextLink ISP Management System. This is the *Backend Engine*
layer recommended by the SRS: it owns the billing engine, MikroTik RouterOS
provisioning, payment gateway reconciliation and the SMS notification engine.

The Next.js apps (`frontend/` = client portal, `backend/` = admin panel) remain
the presentation layer and talk to this service over HTTP.

---

## Quick start

```bash
cd api-server
npm install
copy .env.example .env        # then fill in the real values
npm run migrate               # creates the Phase 3 tables + seeds staff accounts
npm run dev                   # http://localhost:3001
```

Check it is alive:

```bash
curl http://localhost:3001/health
```

Run the whole platform (API + portal + admin) from the repository root with
`run-all.bat`.

---

## Architecture

```
api-server/
├── src/
│   ├── server.js                 HTTP entry point + graceful shutdown
│   ├── app.js                    Express app, middleware, route mounting
│   ├── config.js                 Validated environment configuration
│   ├── lib/
│   │   ├── db.js                 PostgreSQL pool, query + transaction helpers
│   │   ├── queue.js              Job queue (Redis-backed, in-process fallback)
│   │   ├── logger.js             Structured JSON logging
│   │   └── utils.js              IDs, dates, money formatting
│   ├── middleware/
│   │   ├── auth.js               JWT auth, RBAC, audit logging
│   │   ├── validate.js           Zod request validation
│   │   └── error.js              Error envelope + async handler
│   ├── services/
│   │   ├── mikrotik/
│   │   │   ├── routeros-client.js  RouterOS v6/v7 API protocol client
│   │   │   ├── simulator.js         In-memory fake router
│   │   │   └── index.js             Facade + operation logging
│   │   ├── billing/
│   │   │   ├── engine.js          Recurring billing, dunning, settlement
│   │   │   └── pdf.js             Auto-generated PDF invoice
│   │   ├── payments/
│   │   │   └── gateways.js        bKash / Nagad / SSLCommerz / Rocket + mock
│   │   └── sms/index.js           SMS templates + delivery
│   ├── routes/                    REST resources
│   └── jobs/scheduler.js          Cron: monthly cycle + overdue sweep
├── scripts/
│   ├── migrate.js                 Idempotent schema migration
│   ├── test-e2e.js                40 assertions — full billing pipeline
│   ├── test-portal.js             15 assertions — subscriber isolation
│   └── test-automation.js         21 assertions — disconnect / reconnect loop
└── schema.sql                     Phase 3 DDL (additive only)
```

---

## Environment modes

Every external integration has a `mock`/`simulator` mode so the whole system
runs without credentials or hardware.

| Variable | `mock` | `live` |
|---|---|---|
| `MIKROTIK_MODE` | `simulator` — in-memory router | `live` — real RouterOS over TCP 8728 |
| `PAYMENT_MODE` | `mock` — simulated checkout page | `live` — real gateway APIs |
| `SMS_MODE` | `mock` — logged to `sms_messages` | `live` — HTTP POST to your gateway |
| `REDIS_ENABLED` | `false` — in-process queue | `true` — Redis-backed queue |

To go live, only `.env` changes — no code changes are required.

---

## API reference

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Service, database, queue and mode status |

### Authentication

| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | public | Staff login → JWT |
| `POST` | `/api/auth/subscriber-login` | public | Subscriber login → JWT |
| `POST` | `/api/auth/subscriber-token` | public | Issue a subscriber JWT |
| `GET` | `/api/auth/me` | authenticated | Current principal |
| `GET` | `/api/auth/permissions` | authenticated | Permission matrix for the role |

### Billing

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/api/billing/overview` | super_admin, billing | KPI totals, cycles, recent events |
| `GET` | `/api/billing/invoices` | super_admin, billing | Invoice register (filterable) |
| `GET` | `/api/billing/invoices/:id` | super_admin, billing | Invoice + events + transactions |
| `GET` | `/api/billing/invoices/:id/pdf` | authenticated | Auto-generated PDF invoice |
| `DELETE` | `/api/billing/invoices/:id` | super_admin, billing | Delete an invoice and its records |
| `POST` | `/api/billing/cycle/run` | super_admin, billing | Run the recurring cycle (`dryRun`, `background`) |
| `GET` | `/api/billing/cycles` | super_admin, billing | Cycle history |
| `POST` | `/api/billing/suspend-overdue` | super_admin, billing | Auto-disconnect overdue accounts |
| `GET` | `/api/billing/events` | super_admin, billing | Billing audit trail |
| `GET` | `/api/billing/settings` | super_admin, billing | Effective billing configuration |

### Subscriber portal

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/api/portal/my-invoices` | authenticated | The subscriber's own invoices only |
| `GET` | `/api/portal/my-summary` | authenticated | Outstanding balance, next due date |
| `POST` | `/api/portal/pay` | authenticated | Pay an invoice through a gateway |
| `GET` | `/api/portal/my-events` | authenticated | Billing + router history |

### Payments

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/api/payments/gateways` | public | Available gateways and the active mode |
| `POST` | `/api/payments/initiate` | optional | Start a payment → redirect URL |
| `ALL` | `/api/payments/:gateway/callback` | public | Gateway settlement callback |
| `GET` | `/api/payments/mock/checkout/:transactionId` | mock mode | Simulated hosted checkout page |
| `GET` | `/api/payments/transactions` | super_admin, billing | Transaction ledger |
| `POST` | `/api/payments/verify` | super_admin, billing | Reconcile a transaction with the gateway |
| `GET` | `/api/payments/webhooks` | super_admin, billing | Raw webhook log |

### MikroTik

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/api/mikrotik/status` | staff | Router connectivity and mode |
| `GET` | `/api/mikrotik/secrets` | staff | PPPoE secrets, sessions and queues |
| `GET` | `/api/mikrotik/sessions` | staff | Active PPPoE sessions |
| `POST` | `/api/mikrotik/suspend` | super_admin, billing, support | Disable PPPoE (service cut) |
| `POST` | `/api/mikrotik/restore` | super_admin, billing, support | Enable PPPoE (auto-reconnect) |
| `POST` | `/api/mikrotik/disconnect` | super_admin, support, technician | Force-drop a live session |
| `POST` | `/api/mikrotik/apply-profile` | staff | Change the bandwidth profile |
| `POST` | `/api/mikrotik/provision` | super_admin, billing | Ensure the PPPoE secret exists |
| `GET` | `/api/mikrotik/log` | staff | Router operation audit trail |

### SMS & audit

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/api/sms/messages` | staff | SMS log |
| `POST` | `/api/sms/send` | super_admin, billing, support | Send an ad-hoc SMS |
| `GET` | `/api/audit` | super_admin | Audit log |

---

## Roles

| Role | Scope |
|---|---|
| `super_admin` | Full read/write + audit logs |
| `billing` | Billing module, payments, reports |
| `support` | Tickets, subscriber status, MikroTik control, SMS |
| `technician` | Field jobs, bandwidth reset, live sessions |
| `subscriber` | Own portal data only (strict isolation) |

---

## Database

Phase 3 adds these tables. All statements are `CREATE TABLE IF NOT EXISTS`, so
the migration is safe to re-run and never touches the legacy tables:

`subscriber_billing` · `billing_cycles` · `payment_transactions` ·
`payment_webhooks` · `billing_events` · `mikrotik_sync_log` · `sms_messages` ·
`audit_log` · `api_users`

> The legacy `invoices` table is reused for generated invoices. The billing
> metadata lives in its `raw_data` JSONB column — the column that the existing
> admin store already round-trips — so no legacy table schema is altered and
> no existing data is lost.

---

## Tests

With the API running on port 3001:

```bash
node scripts/test-e2e.js          # 40 assertions
node scripts/test-portal.js       # 15 assertions
node scripts/test-automation.js   # 21 assertions
```

All three are repeatable — they clean up after themselves.

---

## Production notes

- Set `JWT_SECRET` to a long random string.
- Set `NODE_ENV=production` and put the API behind a TLS-terminating proxy.
- Run `npm run migrate` as part of the deployment step.
- `BILLING_CURRENCY` / `BILLING_CURRENCY_SYMBOL` label the generated invoices;
  the underlying `packages.price` values are left untouched.
- The queue falls back to an in-process queue when Redis is unreachable, which
  is fine for a single node but should be enabled for multi-node deployments.

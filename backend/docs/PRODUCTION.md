# NextLink Global — Production Deployment

This document explains how to run the platform as a live production system. Read the
whole file before going live; skipping any step leaves a silently mocked gateway live.

## 1. Prerequisites

| Requirement | Why |
|---|---|
| PostgreSQL 14+ | Single source of truth for subscribers, invoices, tickets |
| Redis 6+ | Job queue for billing cycle, suspend/restore, SMS dispatch |
| HTTPS termination (Nginx/Caddy) | WSS/secure cookies, webhook callbacks must not travel plaintext |
| TLS cert valid for `*.your-domain.com` | Payment callback URLs must be reachable and HTTPS |
| A live MikroTik RouterOS box with API access | Real PPPoE provisioning (port 8728 or 8729) |
| Merchant account for at least one payment gateway | Real money — SSLCommerz, bKash or Nagad |
| An SMS provider account with HTTP gateway | Bill reminders, suspend/restore notices |

## 2. Configuration

In production the following **must** hold or the API refuses to boot:

```
JWT_SECRET=<long-random-string, >= 24 chars>
PAYMENT_MODE=live
MIKROTIK_MODE=live
SMS_MODE=live
CORS_ORIGINS=https://portal.your-domain.com,https://admin.your-domain.com
```

If any of these are missing the API aborts with a list of problems instead of
starting a silently-fake billing system.

Use `.env.production` as the starting point:

```powershell
cd backend\api
Copy-Item .env.production.example .env
# edit .env — fill in real credentials
npm start   # runs scripts/start-production.js which pins NODE_ENV=production
```

`npm run dev` keeps `NODE_ENV=development` and allows mock modes for testing.

## 3. Production flow (what changes from dev)

- **Payments** — every live gateway signs/verifies callbacks before any invoice is
  marked paid. A forged callback is rejected before anything settles. In mock
  mode only, `/api/payments/mock/checkout/:txnId` exists; in live mode it returns 404.
- **MikroTik** — billing suspends a subscriber the moment the grace days pass and
  restores the moment payment settles. In live mode a router that is unreachable
  does **not** mark the line as suspended; the attempt is recorded against
  `mikrotik_sync_log` with status `failed` and the sweep will retry next day.
- **SMS** — live provider only; a provider that is unreachable logs `failed` with the
  provider's own error message. Messages are never marked `sent` unless the
  provider acknowledged them.
- **CORS** — only the portal and admin origins are accepted.

## 4. First-run checklist

1. Apply the additive schema: `node backend\api\scripts\migrate.js`
2. Seed the staff accounts: included in `migrate.js`. **Rotate the seeded passwords before going live.**
3. Verify the live MikroTik connection from the admin: **Settings → MikroTik → Test Router Connection**. It must return `Online` before saving live mode.
4. Send a **single** live test SMS from the admin to a real phone. Confirm delivery on the handset before releasing billing.
5. Send a **sandbox** payment for the smallest package through SSLCommerz sandbox or bKash sandbox to a real account. Confirm: invoice flips paid, MikroTik PPPoE secret re-enabled, and an SMS is enqueued.
6. Only then open the customer portal to real subscribers.

## 5. Rollback

- Additive migrations are safe to re-run and are not destructive.
- The production gate is intentionally strict, so you cannot accidentally boot into
  mock mode. To roll back a bad config, restore the previous `.env` and
  `npm run dev` (development mode for the next cutover).
- The demo accounts can be reactivated with `node scripts/restore-demo-state.js`
  if the 03:00 daily sweep has suspended everyone due to overdue demo invoices.

## 6. Monitoring

- `/health` on the API: reports database presence, queue depth, and whether each
  downstream (MikroTik/Payment/SMS) is currently in `live` or `mock` mode.
- `mikrotik_sync_log`: every router action with status and payload.
- `payment_webhooks`: every callback received and what was done with it.
- `sms_messages`: every notification dispatched and its provider state.
- `audit_log`: every staff action, every portal self-service action.

## 7. What is NOT covered

- Online MikroTik configuration must be done on the router itself before enabling
  live MikroTik mode — see the router's own docs. The application only toggles
  PPPoE secret state.
- Payment gateway merchant approvals are external. The app is ready for any of the
  three gateway flows; approval delays belong to the gateway, not the app.
- TLS certificates and Nginx are your responsibility or your hosting provider's.

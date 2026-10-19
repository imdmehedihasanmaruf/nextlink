# Testing

## Phase 1 frontend verification

Verified against Next.js 16.4.0 in the frontend project on 13 October 2026.

### Automated checks

Commands run from `frontend/`:

- `npm run lint` — passed with no warnings.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed; Next.js generated the static and partial-prerendered routes.

## Deferred backend checklist

When Phase 2 is approved, add API tests for authorization, data ownership, validation, billing, payments, router operations, notification delivery, and audit logging. No backend tests or integrations were run during this frontend phase.
# Run tests with coverage
npm run test:coverage
```

## Test Coverage
- Authentication and authorization
- Subscriber management
- Billing and payments
- MikroTik integration
- Ticket management
- API endpoints
- Input validation
- Error handling

## Test Data
- Use test database for automated tests
- Create test subscribers with known credentials
- Use sandbox payment gateway accounts
- Use test MikroTik router configuration
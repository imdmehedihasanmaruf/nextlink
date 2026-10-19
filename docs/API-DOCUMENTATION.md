# API Documentation

## Overview
The ISP Management System provides a REST API with a consistent `/api/v1/` prefix.

## Base URL
```
http://127.0.0.1:8000/api/v1
```

## Authentication
All protected endpoints require authentication via Bearer token.

```
Authorization: Bearer {token}
```

## Response Format
All API responses follow a consistent format:

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {}
}
```

## Error Response Format
```json
{
  "success": false,
  "message": "Error description",
  "errors": {
    "field": ["Error message"]
  }
}
```

## Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | User login |
| POST | `/auth/logout` | User logout |
| POST | `/auth/register` | User registration |
| POST | `/auth/refresh` | Refresh token |

### Subscribers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/subscribers` | List all subscribers |
| POST | `/subscribers` | Create new subscriber |
| GET | `/subscribers/{id}` | Get subscriber details |
| PUT | `/subscribers/{id}` | Update subscriber |
| DELETE | `/subscribers/{id}` | Delete subscriber |

### Packages
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/packages` | List all packages |
| POST | `/packages` | Create new package |
| GET | `/packages/{id}` | Get package details |
| PUT | `/packages/{id}` | Update package |
| DELETE | `/packages/{id}` | Delete package |

### Billing
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/bills` | List all bills |
| POST | `/bills` | Create new bill |
| GET | `/bills/{id}` | Get bill details |
| PUT | `/bills/{id}` | Update bill |

### Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/payments` | List all payments |
| POST | `/payments` | Create new payment |
| GET | `/payments/{id}` | Get payment details |

### MikroTik
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/mikrotik/routers` | List all routers |
| POST | `/mikrotik/routers` | Create new router |
| POST | `/mikrotik/{router}/pppoe/create` | Create PPPoE user |
| POST | `/mikrotik/{router}/pppoe/disable` | Disable PPPoE user |

### Tickets
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tickets` | List all tickets |
| POST | `/tickets` | Create new ticket |
| GET | `/tickets/{id}` | Get ticket details |
| PUT | `/tickets/{id}` | Update ticket |

## Implemented API status (Phase 2 foundation)

Base URL: `http://127.0.0.1:8000/api/v1`. Responses use `{ success, message?, data, meta? }`; validation failures return Laravel's JSON `message` and `errors` fields. Authentication uses Sanctum personal access bearer tokens. Public access is limited to active packages; protected endpoints require a valid token.

| Method | Path | Access / purpose |
|---|---|---|
| POST | `/auth/login` | Public, 5/minute; returns token and safe user profile |
| POST | `/auth/logout` | Authenticated; revoke current token |
| GET | `/auth/me` | Authenticated; current user and own subscriber profile |
| PUT | `/auth/password` | Authenticated; requires current password and confirmed 12+ character password |
| GET | `/packages`, `/packages/{id}` | Public; active plans only |
| POST | `/coverage/check` | Public, 30/minute; returns `available` and `configured` separately |
| POST | `/applications` | Public, 5/minute; validated application, optional private identity upload |
| POST/PUT | `/packages`, `/packages/{id}` | Super Admin; create/update plan |
| GET | `/dashboard` | Staff; financial figures only for Super Admin and Accounts/Billing |
| GET/POST | `/subscribers` | Staff read; Super Admin/Accounts create |
| GET/PUT/DELETE | `/subscribers/{id}` | Policy-controlled; owner contact updates only; delete Super Admin |
| GET | `/invoices`, `/invoices/{id}` | Accounts/Billing/Super Admin or own subscriber |
| POST | `/invoices/generate` | Accounts/Billing/Super Admin; idempotent per subscriber and period |
| GET | `/payments` | Accounts/Billing/Super Admin or own subscriber |
| POST | `/payments` | Own subscriber; records pending transaction, not a gateway payment |
| POST | `/payments/{id}/verify` | Accounts/Billing/Super Admin; transactional, idempotent verification |
| GET/POST | `/tickets` | Helpdesk/Super Admin, assigned Technician, or own Subscriber |
| PATCH | `/tickets/{id}` | Helpdesk/Super Admin; assign/status/priority |
| POST | `/tickets/{id}/messages` | Ticket owner, assigned technician, Helpdesk/Super Admin |

List endpoints accept `per_page` (1–100); subscribers also accept `search` and `status`. Common status codes: 401 unauthenticated, 403 forbidden, 404 missing/hidden resource, 409 invalid state, 422 validation/business rule, 429 rate limited. Full reports, staff/settings, public applications, password-reset delivery, live gateway callbacks, and live MikroTik operations remain unimplemented pending separate module work and external credentials.

### Authentication and CORS

Sanctum tokens are returned only at successful login. Frontend requests send `Authorization: Bearer …`. The backend allows only origins listed in `CORS_ALLOWED_ORIGINS`; credentialed cookies are disabled in this token-based phase. Never place backend secrets in `NEXT_PUBLIC_*` variables.

## Status Codes
- `200 OK` - Success
- `201 Created` - Resource created
- `400 Bad Request` - Invalid input
- `401 Unauthorized` - Authentication required
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error
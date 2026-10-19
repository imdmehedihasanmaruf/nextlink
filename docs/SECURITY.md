# Security

## Access Control
- Role-based access control (RBAC)
- Super Admin, Admin, Staff, Subscriber roles
- Route-level authorization via middleware
- Method-level authorization via policies

## Credential Handling
- Never commit `.env` files
- Use `.env.example` as sanitized template
- Store database passwords in environment variables
- Use Laravel's secure configuration
- Rotate secrets regularly

## Payment Security
- Use test/sandbox mode for development
- Never store raw payment credentials
- Use tokenized payment processing
- Validate all payment webhooks
- Implement idempotency checks

## Router Security
- MikroTik credentials stored in encrypted format
- Use dedicated service accounts with limited privileges
- Never expose router credentials in logs or responses
- Implement connection timeouts and retry limits

## API Security
- Authentication via Bearer tokens
- CSRF protection enabled
- Input validation via Form Requests
- Rate limiting on authentication endpoints
- HTTPS in production
- Never treat frontend role selectors or route visibility as authorization; enforce access on the API.
- The current browser token is stored in `sessionStorage`, which is exposed to same-origin JavaScript. Review an HttpOnly-cookie/BFF approach and XSS defenses before handling production accounts.

## Current implementation caveats
- These are requirements, not certification that every control is implemented.
- Admin/client/technician UI still includes demo screens and simulated login. Do not expose demo role selection as a production auth flow.
- Payment gateway callbacks, SMS delivery and live MikroTik operations are not implemented. Do not mark external transactions or router operations successful without provider verification.
- Production deployment must set `APP_DEBUG=false`, a generated `APP_KEY`, HTTPS origins, exact CORS allowlists, and non-development DB/mail/queue/cache settings.

## General Security
- Keep dependencies updated
- Regular security audits
- Use prepared statements (Laravel Eloquent)
- Implement proper error handling
- Log security events
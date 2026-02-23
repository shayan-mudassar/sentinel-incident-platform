# Authentication & Authorization

## JWT Authorizer
- API Gateway uses a Lambda request authorizer (`services/auth-authorizer`).
- Cognito User Pool is required for `prod` deployments.
- The authorizer validates JWTs and enforces a tenant claim match with `X-Tenant-Id`.

### Required claims
- `sub` is used as the user identifier.
- `custom:tenantId` (or `tenantId`) must match `X-Tenant-Id`.

### Roles (Cognito Groups)
- Supported groups: `ADMIN`, `USER`.
- The authorizer passes `cognito:groups` into the request context as `roles` (comma-separated).

## Ownership Rules
- Incidents created via authenticated ingestion can carry `ownerUserId`.
- Rules:
  - `ADMIN` can view and act on all incidents.
  - `USER` can view and act on incidents where `ownerUserId` matches their user `sub`.
  - Unauthenticated requests are allowed only when auth is disabled (dev mode) or ingestion auth is explicitly off.

## DEV Mode
- When Cognito is not configured, non-prod stages allow a dev bypass.
- In prod, Cognito must be configured (SAM template enforces this).

## Request Context Fields
Handlers read from `event.requestContext.authorizer`:
- `sub` (user id)
- `email` (if present)
- `roles` (comma-separated groups)
- `tenantId`
- `mode` (`dev` / `optional` when auth bypassed)

# Parity Plan (Phase 0)

## Missing / Desirable Endpoints
- `GET /health` (required): not present yet.
- `GET /metrics` exists but is not standardized across error/response shapes and has no `/health` parity.
- Swagger UI serving is not present.

## Inconsistencies Found
- **Error shape**: Current API responses use `{ error, message, details }`, but no requestId. Different handlers return different `message`/`error` values.
- **Response headers**: `X-Request-Id` is not returned, and correlation IDs are not standardized across responses.
- **Logging**: Logger exists but doesn’t enforce requestId/context or redaction; no standard fields for API routes.
- **Auth behavior**: Default authorizer applies globally; per-route optional auth depends on authorizer logic rather than method-level config.
- **Pagination**:
  - `nextToken` is base64url but not consistently surfaced with `pageSize` or `items` metadata.
  - Validation errors vary by endpoint.
- **Validation messages**: Some endpoints return `invalid_*` vs `missing_*` without consistent codes.
- **OpenAPI**: Existing `infra/openapi.yaml` does not represent a standard error shape or requestId header, and does not include `/health`.

## Parity Improvements Planned
- Add shared HTTP response helper with consistent error format and `X-Request-Id` header.
- Add structured logging wrapper and propagate requestId via headers and async messages.
- Introduce `/health` endpoint and formalize `/metrics` semantics.
- Define ownership + role rules and enforce in handlers.
- Add API key option for ingestion and document rate limiting.
- Provide Swagger UI surface.
- Add seed/demo scripts.
- CI workflow for lint/test/build.

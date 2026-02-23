# Parity Plan (Phase 0)

## Missing / Desirable Endpoints
- `GET /health` added.
- `GET /metrics` added (service-level).
- `GET /v1/metrics` remains for tenant counters.

## Inconsistencies Addressed
- **Error shape** standardized to `{ error: { code, message, details?, requestId } }`.
- **Response headers** now include `X-Request-Id`.
- **Logging** standardized with requestId/correlationId and redaction.
- **Pagination** now uses `pageSize` consistently; responses include `pageSize`.
- **OpenAPI** updated with full schemas, error shape, and new endpoints.

## Remaining Follow-ups (if desired)
- Extend ownership model to include assignees.
- Add tenant-level usage plans if per-tenant throttling is required.

# API Inventory

Source of truth: `infra/template.yaml`, `infra/openapi.yaml`, and handler implementations in `services/`.

## API Gateway Routes (current)

### GET `/health`
- **Auth**: None.
- **Response**:
```json
{
  "status": "ok",
  "service": "sentinel",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### GET `/metrics`
- **Auth**: None.
- **Response**:
```json
{
  "service": "sentinel",
  "version": "abc123",
  "uptimeSeconds": 12345,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### POST `/v1/events`
- **Auth**:
  - JWT required when ingestion auth is enabled.
  - Optional `X-API-KEY` when `INGEST_API_KEY` is set and request is unauthenticated.
- **Headers**:
  - `X-Tenant-Id` (required)
  - `Authorization: Bearer <JWT>` (optional or required based on config)
  - `X-API-KEY` (optional; required when configured and unauthenticated)
  - `Idempotency-Key` (optional)
- **Request body** (example):
```json
{
  "eventId": "evt-123",
  "source": "checkout-service",
  "type": "error_spike",
  "severityHint": "high",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "fingerprint": "HTTP_500_/checkout",
  "attributes": {"env":"prod","region":"us-east-1"},
  "idempotencyKey": "optional-key"
}
```
- **Response**:
```json
{
  "accepted": true,
  "eventId": "evt-123",
  "status": "published",
  "idempotencyKey": "optional-key"
}
```
- **Duplicate replay**:
```json
{
  "accepted": true,
  "eventId": "evt-123",
  "status": "published",
  "duplicate": true
}
```
- **Errors (shape)**:
```json
{
  "error": {
    "code": "invalid_event",
    "message": "Event payload failed validation.",
    "details": ["..."],
    "requestId": "..."
  }
}
```

**Frontend usage**: `/web` “Ingest Event” panel (`web/src/api.ts` → `ingestEvent`).

---

### GET `/v1/incidents`
- **Auth**: Required when Cognito is configured.
- **Headers**: `X-Tenant-Id` required.
- **Query params**:
  - `status` (defaults to `OPEN`)
  - `source`, `env`, `severity`
  - `from`, `to` (ISO date-time range)
  - `pageSize` (1–100)
  - `nextToken` (base64url-encoded pagination token)
- **Response**:
```json
{
  "items": [{
    "incidentId": "inc-1",
    "tenantId": "tenant-1",
    "ownerUserId": "user-1",
    "status": "OPEN",
    "source": "checkout-service",
    "fingerprint": "HTTP_500_/checkout",
    "env": "prod",
    "severity": "high",
    "openedAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:01:00.000Z",
    "lastEventAt": "2024-01-01T00:01:00.000Z",
    "eventCount": 3,
    "version": 2,
    "aiSummary": "Checkout API errors spiked, impacting payments.",
    "aiSeverityRecommendation": "high",
    "aiSuggestedActions": ["Roll back recent deploy", "Check error logs"],
    "aiConfidence": 0.72,
    "aiStatus": "completed",
    "aiLastAnalyzedAt": "2024-01-01T00:01:30.000Z",
    "aiModel": "gpt-4o-mini",
    "aiProvider": "mock"
  }],
  "nextToken": "eyJwayI6ICJ...",
  "pageSize": 25
}
```

**Frontend usage**: `/web` “Incidents” list (`web/src/api.ts` → `listIncidents`).

---

### GET `/v1/incidents/{incidentId}`
- **Auth**: Required when Cognito is configured.
- **Headers**: `X-Tenant-Id` required.
- **Response**:
```json
{
  "incident": {
    "incidentId": "inc-1",
    "tenantId": "tenant-1",
    "ownerUserId": "user-1",
    "status": "OPEN",
    "source": "checkout-service",
    "fingerprint": "HTTP_500_/checkout",
    "env": "prod",
    "severity": "high",
    "openedAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:01:00.000Z",
    "lastEventAt": "2024-01-01T00:01:00.000Z",
    "eventCount": 3,
    "version": 2,
    "aiSummary": "Checkout API errors spiked, impacting payments.",
    "aiSeverityRecommendation": "high",
    "aiSuggestedActions": ["Roll back recent deploy", "Check error logs"],
    "aiConfidence": 0.72,
    "aiStatus": "completed",
    "aiLastAnalyzedAt": "2024-01-01T00:01:30.000Z",
    "aiModel": "gpt-4o-mini",
    "aiProvider": "mock"
  }
}
```

**Frontend usage**: `/web` incident detail panel (`web/src/api.ts` → `getIncident`).

---

### GET `/v1/incidents/{incidentId}/events`
- **Auth**: Required when Cognito is configured.
- **Headers**: `X-Tenant-Id` required.
- **Query params**: `pageSize` (1–100), `nextToken` (base64url)
- **Response**:
```json
{
  "items": [{
    "incidentId": "inc-1",
    "tenantId": "tenant-1",
    "eventId": "evt-123",
    "source": "checkout-service",
    "type": "error_spike",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "fingerprint": "HTTP_500_/checkout",
    "attributes": {"env":"prod"}
  }],
  "nextToken": "eyJwayI6ICJ...",
  "pageSize": 25
}
```

**Frontend usage**: `/web` timeline panel (`web/src/api.ts` → `listIncidentEvents`).

---

### POST `/v1/incidents/{incidentId}/ack`
- **Auth**: Required when Cognito is configured.
- **Headers**: `X-Tenant-Id` required.
- **Response**:
```json
{ "incidentId": "inc-1", "status": "ACKED", "idempotent": true }
```

**Frontend usage**: `/web` “Ack incident” action (`web/src/api.ts` → `ackIncident`).

---

### POST `/v1/incidents/{incidentId}/resolve`
- **Auth**: Required when Cognito is configured.
- **Headers**: `X-Tenant-Id` required.
- **Response**:
```json
{ "incidentId": "inc-1", "status": "RESOLVED", "idempotent": true }
```

**Frontend usage**: `/web` “Resolve” action (`web/src/api.ts` → `resolveIncident`).

---

### GET `/v1/metrics`
- **Auth**: Required when Cognito is configured.
- **Headers**: `X-Tenant-Id` required.
- **Response**:
```json
{
  "metrics": { "ingested": 42, "deduped": 7 },
  "updatedAt": { "ingested": "2024-01-01T00:00:00.000Z" }
}
```
- **Errors**:
  - `501` when metrics table is not configured.

**Frontend usage**: `/web` metrics panel (`web/src/api.ts` → `getMetrics`).

---

## Notes on Auth & Headers
- Auth is enforced by API Gateway request authorizer when Cognito is configured.
- `X-Tenant-Id` header is required on all `/v1/*` routes.
- `X-Request-Id` is returned in every response header; error bodies include `error.requestId`.

## Frontend Endpoint Map
- `Incidents list`: `GET /v1/incidents`
- `Incident detail`: `GET /v1/incidents/{incidentId}`
- `Timeline`: `GET /v1/incidents/{incidentId}/events`
- `Ack`: `POST /v1/incidents/{incidentId}/ack`
- `Resolve`: `POST /v1/incidents/{incidentId}/resolve`
- `Metrics`: `GET /v1/metrics`
- `Ingest`: `POST /v1/events`

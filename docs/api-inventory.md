# API Inventory

Source of truth: `infra/template.yaml`, `infra/openapi.yaml`, and handler implementations in `services/`.

## API Gateway Routes (current)

### POST `/v1/events`
- **Auth**: Optional. Protected by API Gateway authorizer, but authorizer allows unauthenticated access unless `IngestRequiresAuth=true` and Cognito configured.
- **Headers**:
  - `X-Tenant-Id` (required)
  - `Authorization: Bearer <JWT>` (required only when ingestion auth is enabled)
- **Request body** (example):
```json
{
  "eventId": "evt-123",
  "source": "checkout-service",
  "type": "error_spike",
  "severityHint": "high",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "fingerprint": "HTTP_500_/checkout",
  "attributes": {"env":"prod","region":"us-east-1"}
}
```
- **Responses**:
  - `200`:
```json
{
  "accepted": true,
  "eventId": "evt-123",
  "status": "published"
}
```
  - `200` (idempotent replay):
```json
{
  "accepted": true,
  "eventId": "evt-123",
  "status": "published",
  "duplicate": true
}
```
  - `400` (validation): `{ "error": "validation_error", "message": "invalid_event", "details": ["..."] }`
  - `401` (auth missing/required): `{ "error": "auth_required", "message": "missing_authorization" }`
  - `500` (publish error): `{ "error": "internal_error", "message": "publish_failed" }`

**Frontend usage**: `/web` “Ingest Event” panel (`web/src/api.ts` → `ingestEvent`).

---

### GET `/v1/incidents`
- **Auth**: Required when Cognito is configured (default authorizer).
- **Headers**: `X-Tenant-Id` required.
- **Query params**:
  - `status` (defaults to `OPEN`)
  - `source`, `env`, `severity`
  - `from`, `to` (ISO date-time range)
  - `limit` (1–100)
  - `nextToken` (base64url-encoded pagination token)
- **Response**:
```json
{
  "items": [{
    "incidentId": "inc-1",
    "tenantId": "tenant-1",
    "status": "OPEN",
    "source": "checkout-service",
    "fingerprint": "HTTP_500_/checkout",
    "env": "prod",
    "severity": "high",
    "openedAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:01:00.000Z",
    "lastEventAt": "2024-01-01T00:01:00.000Z",
    "eventCount": 3,
    "version": 2
  }],
  "nextToken": "eyJwayI6ICJ..." 
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
    "status": "OPEN",
    "source": "checkout-service",
    "fingerprint": "HTTP_500_/checkout",
    "env": "prod",
    "severity": "high",
    "openedAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:01:00.000Z",
    "lastEventAt": "2024-01-01T00:01:00.000Z",
    "eventCount": 3,
    "version": 2
  }
}
```

**Frontend usage**: `/web` incident detail panel (`web/src/api.ts` → `getIncident`).

---

### GET `/v1/incidents/{incidentId}/events`
- **Auth**: Required when Cognito is configured.
- **Headers**: `X-Tenant-Id` required.
- **Query params**: `limit` (1–100), `nextToken` (base64url)
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
  "nextToken": "eyJwayI6ICJ..."
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
- Auth is enforced by API Gateway request authorizer when Cognito is configured. Ingest auth is optional based on `IngestRequiresAuth`.
- `X-Tenant-Id` header is required on all routes.

## Frontend Endpoint Map
- `Incidents list`: `GET /v1/incidents`
- `Incident detail`: `GET /v1/incidents/{incidentId}`
- `Timeline`: `GET /v1/incidents/{incidentId}/events`
- `Ack`: `POST /v1/incidents/{incidentId}/ack`
- `Resolve`: `POST /v1/incidents/{incidentId}/resolve`
- `Metrics`: `GET /v1/metrics`
- `Ingest`: `POST /v1/events`

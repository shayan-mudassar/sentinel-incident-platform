# Async Events

Source of truth: `services/*` handlers, `libs/events`, `libs/domain`, `infra/template.yaml`.

## EventBridge → SQS → Incident Engine

### `sentinel.ingest` EventBridge event
Emitted by **Ingest API** (`services/ingest-api`) into EventBridge.

**Detail payload (example)**:
```json
{
  "eventId": "evt-123",
  "source": "checkout-service",
  "type": "error_spike",
  "severityHint": "high",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "fingerprint": "HTTP_500_/checkout",
  "attributes": { "env": "prod", "region": "us-east-1" },
  "env": "prod",
  "receivedAt": "2024-01-01T00:00:01.000Z",
  "correlationId": "evt-123",
  "tenantId": "tenant-1"
}
```

**Route**: EventBridge rule `IngestToQueueRule` sends `sentinel.ingest` to `EventsQueue` (SQS).

**SQS message body**: the EventBridge envelope, where `body.detail` or `body.detail` contains the payload above. The incident engine parses `body.detail || body`.

### Incident Engine processing (`services/incident-engine`)
Consumes SQS records. Key behaviors:
- Dedup window and severity counters stored in `EventStateTable`.
- Updates `IncidentsTable`, `IncidentEventsTable`, and `OutboxTable`.
- Emits metrics to CloudWatch EMF via `emitMetrics`.

## Outbox → EventBridge → Notifications

### Outbox `IncidentChanged` detail
Created by Incident Engine and Incident API (ack/resolve). Stored in `OutboxTable`.

**Detail payload (example)** (from `libs/events`):
```json
{
  "incidentId": "inc-1",
  "tenantId": "tenant-1",
  "changeType": "OPENED",
  "status": "OPEN",
  "severity": "high",
  "source": "checkout-service",
  "fingerprint": "HTTP_500_/checkout",
  "env": "prod",
  "updatedAt": "2024-01-01T00:01:00.000Z",
  "correlationId": "evt-123"
}
```

### Outbox Publisher (`services/outbox-publisher`)
- Polls `OutboxTable` by `status = PENDING`.
- Emits EventBridge `sentinel.incident` events with `detailType=IncidentChanged`.
- Marks outbox records `PUBLISHED` after success.

### Notifications Queue + Worker (`services/notification-worker`)
- EventBridge rule `IncidentChangedRule` pushes `sentinel.incident` to `NotificationsQueue` (SQS).
- Notification Worker parses `body.detail` for `tenantId`, `severity`, `status`, `changeType`, etc.
- Publishes to SNS topics configured in `NotificationTargetsTable` or falls back to `DEFAULT_NOTIFICATION_TOPIC_ARN`.

## Correlation / Request IDs
- Ingest attaches `correlationId` from header `X-Correlation-Id` or eventId.
- Incident Engine and Notification Worker log `correlationId` when present.

## Tables involved
- `EventStateTable`: dedup + severity windows + per-event processing status.
- `IncidentsTable`: active incident state + pointers.
- `IncidentEventsTable`: timeline events.
- `OutboxTable`: pending publish items.
- `NotificationTargetsTable`: tenant+severity routing configuration.
- `MetricsTable`: per-tenant counters.

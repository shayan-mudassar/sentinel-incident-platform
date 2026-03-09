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
  "requestId": "req-abc",
  "tenantId": "tenant-1",
  "ownerUserId": "user-1"
}
```

**Route**: EventBridge rule `IngestToQueueRule` sends `sentinel.ingest` to `EventsQueue` (SQS).

**SQS message body**: the EventBridge envelope; the incident engine parses `body.detail || body`.

### Incident Engine processing (`services/incident-engine`)
Consumes SQS records. Key behaviors:
- Dedup window and severity counters stored in `EventStateTable`.
- Updates `IncidentsTable`, `IncidentEventsTable`, and `OutboxTable`.
- Emits metrics to CloudWatch EMF via `emitMetrics`.
- Propagates `requestId` and `correlationId` into outbox events.

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
  "correlationId": "evt-123",
  "requestId": "req-abc"
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

## Outbox → EventBridge → AI Analysis

### Outbox `IncidentAnalysisRequested` detail
Created by Incident Engine when AI is enabled. Stored in `OutboxTable`.

**Detail payload (example)**:
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
  "correlationId": "evt-123",
  "requestId": "req-abc"
}
```

### AI Analysis Queue + Worker (`services/ai-analysis`)
- Outbox Publisher emits `sentinel.ai` events with `detailType=IncidentAnalysisRequested`.
- EventBridge rule `IncidentAnalysisRequestedRule` sends events to `AiAnalysisQueue`.
- AI Analysis worker loads incident + recent events, builds prompt, calls provider, and stores AI enrichment on the incident record.
- Failures are logged and marked as `aiStatus=failed` without blocking incident flow.

## Correlation / Request IDs
- Ingest attaches `requestId` from `X-Request-Id` or API Gateway request id.
- `correlationId` comes from `X-Correlation-Id` or `eventId`.
- Async handlers log with the propagated IDs when present.

## Tables involved
- `EventStateTable`: dedup + severity windows + per-event processing status.
- `IncidentsTable`: active incident state + pointers.
- `IncidentEventsTable`: timeline events.
- `OutboxTable`: pending publish items.
- `NotificationTargetsTable`: tenant+severity routing configuration.
- `MetricsTable`: per-tenant counters.

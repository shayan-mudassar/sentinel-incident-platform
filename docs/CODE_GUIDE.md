# Sentinel Code Guide (Detailed)

This guide walks through every part of the repository: how the code works, how services
interact, and which AWS components back the microservices.

## How to Read This Guide

- Start with **Repo Map** to understand the layout.
- Read **Service Flows** to see the runtime path.
- Use **File-by-File** for detailed coverage.
- Finish with **AWS Microservices Map** to see all AWS resources.

## Repo Map

```
infra/            SAM template + OpenAPI spec
services/         Lambda handlers (microservices)
libs/             Shared libraries (logging, config, validation, AWS helpers, domain)
scripts/          CLI tools (demo + DLQ replay)
web/              React dashboard (incident list + actions + ingest)
tests/            Jest tests (unit + integration stub)
docs/             Architecture + future plans + this guide
```

## Service Flows (End-to-End)

### 1) Ingestion Flow

1. `API Gateway` receives `POST /v1/events`.
2. `Ingest Lambda` validates payload, applies idempotency, publishes to EventBridge.
3. `EventBridge` forwards all ingestion events to `events-queue` (SQS).

### 2) Incident Processing Flow

1. `Incident Engine Lambda` consumes batch from `events-queue`.
2. It enforces processing idempotency and deduplication in `EventState` table.
3. It correlates to an incident in the `Incidents` table (or creates a new one).
4. It writes a change record to the `Outbox` table.

### 3) Notification Flow

1. `Outbox Publisher Lambda` periodically publishes `Outbox` events to EventBridge.
2. `EventBridge` routes `IncidentChanged` to `notifications-queue` (SQS).
3. `Notification Worker Lambda` consumes and logs human-readable notification messages.

### 4) Incident Query Flow

1. `API Gateway` receives incident queries and commands.
2. `Incident API Lambda` reads `Incidents` table and writes status changes.
3. Status changes create Outbox records for downstream notifications.

## File-by-File Guide

### Root

- `package.json`
  - Workspace config and scripts for build/test/demo/replay.
  - AWS SDK v3, AJV for schema validation, X-Ray, UUID, Jest, TS.

- `tsconfig.json`
  - TypeScript config, path alias `@sentinel/*` to `libs/*/src`.

- `jest.config.js`
  - Jest config for TS tests and module alias mapping.

### `infra/`

- `infra/template.yaml`
  - AWS SAM template defining all resources.
  - Resources include API Gateway, Lambdas, EventBridge, SQS queues/DLQ, DynamoDB tables,
    CloudWatch dashboard, and IAM policies.

- `infra/openapi.yaml`
  - OpenAPI spec for `/v1/events` and `/v1/incidents` endpoints.
  - Documents request/response schemas and security (JWT) for incident endpoints.

### `services/` (Microservices)

Each service is a single AWS Lambda with a clear responsibility.

#### `services/ingest-api/src/handler.ts`

- Parses JSON body and validates schema with AJV.
- Uses `eventId` for idempotency via `Idempotency` table.
- Publishes to EventBridge as `source: sentinel.ingest` and `detail-type: event.type`.
- Emits metric: `events_ingested`.

#### `services/incident-engine/src/handler.ts`

- Consumes SQS events in batches, returns `batchItemFailures` for partial retries.
- Enforces processing idempotency using `EVENT#<eventId>` in EventState table.
- Deduplicates repeated events by `(env, source, fingerprint)` window.
- Correlates to active incident using pointer item in Incidents table.
- Creates or updates incidents; escalates severity if thresholds exceeded.
- Stores recent incident events in `IncidentEvents` table.
- Writes `IncidentChanged` to `Outbox` on open/escalation.
- Emits metrics: `events_deduplicated`, `incidents_opened`, `incidents_escalated`,
  and `processing_latency_ms`.

#### `services/outbox-publisher/src/handler.ts`

- Reads pending outbox records via GSI on `status`.
- Publishes to EventBridge (`detail-type: IncidentChanged`).
- Marks outbox records `PUBLISHED`.

#### `services/notification-worker/src/handler.ts`

- Consumes `notifications-queue` and logs structured notifications.
- Intended as a placeholder for real notification delivery (SNS/email/PagerDuty).

#### `services/incident-api/src/handler.ts`

- `GET /v1/incidents`: list incidents by status/source/env via GSI.
- `GET /v1/incidents/{incidentId}`: fetch incident by id.
- `POST /v1/incidents/{incidentId}/ack`: acknowledge an incident.
- `POST /v1/incidents/{incidentId}/resolve`: resolve an incident.
- Each status change writes an Outbox event.

### `libs/` (Shared Libraries)

#### `libs/logger/src/index.ts`

- JSON logger with contextual fields (requestId, correlationId, etc.).
- Provides `.withContext()` to attach metadata for structured logs.

#### `libs/metrics/src/index.ts`

- Emits metrics using CloudWatch Embedded Metric Format (EMF).
- Avoids separate CloudWatch API calls.

#### `libs/config/src/index.ts`

- Central configuration loader from environment variables.
- Defaults for stage, table names, dedup windows, TTLs.

#### `libs/config/src/rules.ts`

- Loads severity rules from `Rules` table (or falls back to defaults).
- Allows dynamic adjustments without code changes.

#### `libs/schemas/src/event-schema.ts`

- JSON Schema for ingestion event validation.

#### `libs/schemas/src/index.ts`

- AJV validator wrapper for `IngestEvent` schema.

#### `libs/aws/src/index.ts`

- AWS SDK v3 client wrappers with X-Ray tracing enabled.

#### `libs/idempotency/src/index.ts`

- Idempotency helper for ingestion requests.
- Stores `PROCESSING`/`COMPLETED`/`FAILED` states with TTL.

#### `libs/domain/src/index.ts`

- Domain types (Incident, Severity, Event).
- Severity ranking helpers.

#### `libs/events/src/index.ts`

- Incident change event payload builder.

#### `libs/dynamodb/src/event-state.ts`

- Dedup and processing idempotency helpers.
- Window-based counters for `(env, source, fingerprint)`.

#### `libs/dynamodb/src/incidents.ts`

- CRUD and query helpers for incident state and active pointers.
- GSI support for `STATUS` listing.

#### `libs/dynamodb/src/incident-events.ts`

- Writes recent events per incident with TTL.

#### `libs/dynamodb/src/outbox.ts`

- Outbox insert + pending query + publish marker.

### `scripts/`

- `scripts/demo-generate-events.ts`
  - Sends bursts of events to show dedup + escalation.

- `scripts/replay-dlq.ts`
  - Replays DLQ messages to SQS or EventBridge.
  - Includes safeguards (`replayCount`, `replayed`, `--dry-run`).

### `tests/`

- `tests/ingest-schema.test.ts`
  - Unit tests for schema validation.

- `tests/integration/incident-flow.test.ts`
  - Stub integration test for incident list endpoint.

## AWS Microservices Map (Resources)

### API Gateway

- `SentinelApi` (SAM)
  - Routes `POST /v1/events` -> `IngestFunction`.
  - Routes incident endpoints -> `IncidentApiFunction`.
  - Optional Cognito JWT authorizer via parameter.

### Lambda Functions

- `IngestFunction` -> `services/ingest-api`.
- `IncidentEngineFunction` -> `services/incident-engine`.
- `OutboxPublisherFunction` -> `services/outbox-publisher`.
- `NotificationWorkerFunction` -> `services/notification-worker`.
- `IncidentApiFunction` -> `services/incident-api`.

### EventBridge

- `SentinelBus`: shared event bus.
- `IngestToQueueRule`: routes `source: sentinel.ingest` to `events-queue`.
- `IncidentChangedRule`: routes `detail-type: IncidentChanged` to `notifications-queue`.

### SQS

- `EventsQueue`: main processing queue for incident engine.
- `EventsDlq`: DLQ for poison messages from EventsQueue.
- `NotificationsQueue`: notification delivery queue.

### DynamoDB

- `IncidentsTable`: incident state + active pointer items.
- `EventStateTable`: dedup counters + processing idempotency records.
- `IncidentEventsTable`: recent events per incident.
- `OutboxTable`: pending incident change events.
- `IdempotencyTable`: ingestion idempotency records.
- `RulesTable`: severity threshold configuration.

### Observability

- CloudWatch EMF metrics emitted from Lambdas.
- X-Ray tracing enabled in SAM `Globals` for Lambdas.
- `SentinelDashboard` provides quick visibility of core metrics.

## Why These Microservices

- **Ingest API**: isolates validation and idempotency from downstream processing.
- **Incident Engine**: encapsulates dedup/correlation/severity logic.
- **Outbox Publisher**: ensures reliable event emission after state updates.
- **Notification Worker**: decouples delivery channel from incident logic.
- **Incident API**: read/update incidents without exposing internal tables.

## How to Trace an Event in Code

1. Start at `services/ingest-api/src/handler.ts`.
2. Follow EventBridge rule in `infra/template.yaml` to `EventsQueue`.
3. Continue in `services/incident-engine/src/handler.ts`.
4. Look at DynamoDB helpers in `libs/dynamodb/src/*.ts`.
5. Follow outbox in `services/outbox-publisher/src/handler.ts`.
6. See notifications in `services/notification-worker/src/handler.ts`.

## Notes on Extension Points

- Add a new notification channel by extending `notification-worker`.
- Add new severity rules by writing `ruleId=default` into `RulesTable`.
- Add new event types without changing schema (uses generic `type` field).

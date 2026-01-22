# Sentinel Architecture and Code Guide

This document explains how the Sentinel codebase works, the system design and why it was chosen,
and the code architecture that ties it together.

## System Design (What and Why)

Sentinel is an event-driven, serverless incident platform. It ingests operational events, reduces
noise through deduplication, correlates related events into incidents, computes severity with
configurable rules, and emits incident change notifications. The design goals are:

- Resilient processing with retries, DLQs, and idempotent writes
- Low operational overhead using managed AWS services
- Clear separation of ingestion, processing, and notification paths
- Observability with structured logs, metrics, and tracing

### Why EventBridge + SQS

- EventBridge decouples ingestion from processing and supports event fan-out later.
- SQS provides durable buffering, retry and backoff semantics, and DLQs for poison messages.
- This combination supports at-least-once delivery while keeping the system safe via idempotency.

### Why DynamoDB

- Low-latency reads/writes for incident state and counters.
- TTL for automatic cleanup of idempotency and dedup state.
- Conditional writes and transactions help prevent race conditions.

### Why Outbox Pattern

Publishing side-effects (notifications, downstream events) directly inside the incident processor
can lead to partial failures. The outbox pattern makes incident state changes and side-effects
atomic by first writing to DynamoDB, then publishing from a separate worker.

## High-Level Architecture

```
Client
  |
  v
API Gateway (/v1/events) -> Ingest Lambda -> EventBridge Bus
                                                |
                                                v
                                         SQS events-queue
                                                |
                                                v
                                    Incident Engine Lambda
                                   /       |        |       \
                         EventState   Incidents   IncidentEvents   Outbox
                                                |
                                                v
                                      Outbox Publisher Lambda
                                                |
                                                v
                                         EventBridge Bus
                                                |
                                                v
                                     SQS notifications-queue
                                                |
                                                v
                                   Notification Worker Lambda

API Gateway (/v1/incidents...) -> Incident API Lambda -> DynamoDB
```

## Core Flows (How the Code Works)

### 1) Event Ingestion

Entry point: `services/ingest-api/src/handler.ts`

Steps:

1. Parse JSON body.
2. Validate against JSON Schema (`libs/schemas/src/event-schema.ts`).
3. Enforce idempotency using `eventId` in `Idempotency` table.
4. Publish to EventBridge (`source: sentinel.ingest`, `detail-type: event.type`).
5. Return 200 with the same response for any replayed `eventId`.

Why:

- Idempotency protects against client retries and gateway redelivery.
- Schema validation prevents garbage from entering the event backbone.

### 2) Event Backbone and Queue

EventBridge rule routes all ingestion events to `events-queue`. The SQS queue has a DLQ
(`events-dlq`) and a redrive policy that sends poison messages after 3 failed attempts.

Why:

- Separates ingestion from processing and provides reliability via retries and DLQ.

### 3) Deduplication + Correlation + Severity

Entry point: `services/incident-engine/src/handler.ts`

For each SQS record:

1. Parse event detail and extract `env`, `source`, and `fingerprint`.
2. Enforce processing idempotency by writing `EVENT#<eventId>` into EventState table.
3. Update dedup counters by `(env, source, fingerprint)`.
4. Evaluate severity based on `severityHint` and configured thresholds.
5. Look up active incident pointer for `(env, source, fingerprint)`.
6. Create incident if no active pointer exists, otherwise update existing incident.
7. Store recent incident events and write an outbox record when incident changes.

Why:

- Dedup reduces noisy, repeated events within a short window.
- Pointer-based correlation avoids duplicate incident creation under concurrency.
- Conditional writes and transactions reduce race conditions.

### 4) Outbox Publishing

Entry point: `services/outbox-publisher/src/handler.ts`

Steps:

1. Query `Outbox` table for `PENDING` records via GSI.
2. Publish to EventBridge (`detail-type: IncidentChanged`).
3. Mark outbox record as `PUBLISHED`.

Why:

- Separates state mutation from side-effects for reliability and replay.

### 5) Notifications

Entry point: `services/notification-worker/src/handler.ts`

Steps:

1. Consume incident change events from `notifications-queue`.
2. Log a human-readable notification.

Why:

- Keeps notifications decoupled and easy to extend later (SNS/email/PagerDuty).

### 6) Incident API

Entry point: `services/incident-api/src/handler.ts`

Endpoints:

- `GET /v1/incidents`: list incidents by status/source/env.
- `GET /v1/incidents/{incidentId}`: fetch incident.
- `POST /v1/incidents/{incidentId}/ack`: acknowledge incident.
- `POST /v1/incidents/{incidentId}/resolve`: resolve incident.

Incident changes are written to the outbox to trigger downstream notifications.

## Data Model and Access Patterns

### DynamoDB: Incidents Table

Single table with multiple item types:

- Incident state item
  - PK: `INCIDENT#<incidentId>`
  - SK: `STATE`
  - GSI1: `STATUS#<status>` / `SOURCE#<source>#ENV#<env>#UPDATED#<updatedAt>`
- Active pointer item
  - PK: `INCIDENTKEY#<env>#<source>#<fingerprint>`
  - SK: `ACTIVE`
  - Contains `incidentId`

Why:

- The pointer ensures only one active incident per key.
- GSI supports listing by status and filtering by source/env.

### DynamoDB: EventState Table

- Event idempotency: PK `EVENT#<eventId>`
- Dedup window: PK `DEDUP#<env>#<source>#<fingerprint>`, SK `WINDOW`

Why:

- Prevents duplicate processing across retries.
- Provides a rolling window counter to suppress duplicate signals.

### DynamoDB: IncidentEvents Table

- PK `INCIDENT#<incidentId>`, SK `EVENT#<timestamp>#<eventId>`

Why:

- Stores recent events per incident for troubleshooting and auditing.

### DynamoDB: Outbox Table

- PK `outboxId`, status GSI on `status` + `createdAt`

Why:

- Allows reliable publish after state changes and replays.

## Code Architecture (How the Repo is Organized)

Monorepo layout:

```
services/  -> Lambda handlers (each service is a single-purpose function)
libs/      -> Shared libraries (logging, config, schemas, AWS clients, domain types)
infra/     -> SAM template and OpenAPI spec
scripts/   -> Demo generation and DLQ replay tooling
tests/     -> Jest unit tests + integration stub
```

### Shared Libraries

- `libs/logger`: JSON structured logging
- `libs/config`: environment-based configuration and severity rules
- `libs/schemas`: JSON Schema validation with AJV
- `libs/aws`: AWS SDK clients with X-Ray capture
- `libs/dynamodb`: DynamoDB access helpers and data model primitives
- `libs/domain`: domain types (Incident, Severity, etc.)
- `libs/events`: incident change event payloads
- `libs/idempotency`: idempotency helper for ingestion
- `libs/metrics`: EMF metrics emitter

Why:

- Keeps Lambda handlers focused on orchestration.
- Shared code reduces drift across services.

### Lambda Services

Each Lambda is single-purpose and configured via environment variables. This makes it easier to
scale, test, and deploy independently.

## Observability

- Structured JSON logs include `requestId`, `correlationId`, `eventId`, `incidentId`, `source`,
  and `fingerprint`.
- CloudWatch Embedded Metrics emit key counters (ingested, deduplicated, opened, escalated,
  processing latency).
- AWS X-Ray tracing enabled for all Lambdas.

## Failure Handling and Resilience

- **Idempotent ingestion**: Replays return the same response without duplicate publishes.
- **Processor retries**: SQS retries failed messages, with DLQ after max receive count.
- **Outbox guarantees**: Incident changes are stored before external publication.
- **Replay tooling**: DLQ messages can be safely reprocessed with loop guards.

## Design Tradeoffs

- **At-least-once delivery**: SQS and EventBridge favor reliability; idempotency guards duplicates.
- **DynamoDB single-table patterns**: More complex data modeling, but faster queries and fewer tables.
- **Outbox delay**: Notification is not synchronous with state update, but improves resilience.

## File References

- SAM template: `infra/template.yaml`
- OpenAPI spec: `infra/openapi.yaml`
- Ingestion Lambda: `services/ingest-api/src/handler.ts`
- Incident Engine: `services/incident-engine/src/handler.ts`
- Incident API: `services/incident-api/src/handler.ts`
- Outbox Publisher: `services/outbox-publisher/src/handler.ts`
- Notification Worker: `services/notification-worker/src/handler.ts`
- DynamoDB helpers: `libs/dynamodb/src/index.ts`
- Schemas: `libs/schemas/src/index.ts`

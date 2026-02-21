# Sentinel

Sentinel is a serverless, event-driven incident and reliability platform (mini-PagerDuty) built on AWS.
It ingests operational events, deduplicates noise, correlates related signals into incidents, applies
rule-based severity and routing, and emits notifications/actions with end-to-end observability.

## Architecture

```
                  +---------------------+
                  |  API Gateway        |
                  |  /v1/events         |
                  +----------+----------+
                             |
                             v
                       Ingest Lambda
                  (idempotency + validate)
                             |
                             v
                       EventBridge Bus
                             |
                             v
                       SQS events-queue
                             |
                             v
                    Incident Engine Lambda
          (dedup + correlate + severity + outbox)
                  |        |          |
                  |        |          +--> IncidentEvents table
                  |        +--> Incidents table
                  +--> EventState table
                             |
                             v
                       Outbox table
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

      +-------------------+               +----------------------+
      | API Gateway       |<-------------| Incident API Lambda  |
      | /v1/incidents     |              | (query/ack/resolve)   |
      +-------------------+               +----------------------+
```

## Key Design Decisions

- **EventBridge + SQS backbone**: EventBridge decouples ingestion from processing; SQS provides retry,
  backoff, and DLQ safety for the incident engine.
- **DynamoDB for state**: Incidents, dedup state, idempotency records, and outbox are modeled as
  single-table-style items for low-latency, cost-efficient access patterns.
- **Outbox pattern**: Incident changes are written to an outbox table first, then published in a
  separate lambda to avoid partial failures and enable replay.
- **EMF metrics**: CloudWatch Embedded Metric Format (EMF) in logs gives metrics without separate API calls.

## Multi-tenancy & Auth

- **Tenant isolation**: All APIs require `X-Tenant-Id` and store data under tenant-scoped keys.
- **Auth enforcement**: If `CognitoUserPoolId` is set, JWT auth is enforced on incident APIs. In prod
  (`Stage=prod`), Cognito is required. In non-prod, auth can be disabled for DEV-only use.
- **Ingestion auth**: Use `IngestRequiresAuth=true` to require JWTs for `/v1/events`.

## Idempotency & Deduplication

- **Ingestion idempotency**: `eventId` is stored in the Idempotency table with TTL (scoped by tenant).
  Replays return the same response and do not republish to EventBridge.
- **Processing idempotency**: The incident engine writes a `EVENT#<eventId>` record into EventState
  (scoped by tenant) with TTL to avoid double-counting on retries.
- **Deduplication**: Events with the same `(tenantId, env, source, fingerprint)` within `DEDUP_WINDOW_MS`
  increment a counter; only the first event in the window is processed and the rest are suppressed.

## Correlation & Severity

- **Correlation key**: `(tenantId, env, source, fingerprint)` controls which incident receives new events.
  Active incidents are tracked by a pointer item so concurrent processors avoid creating duplicates.
- **Severity**: Start with `severityHint` (if provided) and then escalate if the count in the
  current window crosses thresholds (defaults in `libs/config/src/rules.ts`).
  Rules can be overridden by writing a `ruleId=TENANT#<tenantId>` item into the `Rules` table
  (optional `dedupWindowMs` and `severityWindowMs` override defaults).

## Notifications

- **NotificationTargets table**: maps `(tenantId, severity)` to destination SNS topics. Use
  `SEVERITY#ALL` to apply to all severities.
- **Severity keys**: use `SEVERITY#low|medium|high|critical` (lowercase to match event payloads).
- **Email**: set `IncidentNotificationEmail` to subscribe the stack’s `sentinel-<stage>-notifications`
  topic, then create a NotificationTargets item pointing at that topic.
- **Slack (AWS Chatbot)**: attach an AWS Chatbot Slack configuration to a tenant-specific SNS topic,
  then store that topic ARN in NotificationTargets for the tenant.
- **Fallback**: if no NotificationTargets are configured for a tenant, notifications are published
  to the stack notifications topic (if any subscribers exist).
- **IAM note**: notification worker publish permissions default to `sentinel-<stage>-*` SNS topics.
  Use that naming convention or expand the policy if you need custom topic names.

Example NotificationTargets item:

```json
{
  "pk": "TENANT#demo",
  "sk": "SEVERITY#ALL",
  "targets": [{ "type": "SNS", "topicArn": "<notifications-topic-arn>" }]
}
```

## Defaults & TTLs

- `DEDUP_WINDOW_MS`: 5 minutes (tenant-overridable via Rules table).
- `SEVERITY_WINDOW_MS`: 5 minutes (tenant-overridable via Rules table).
- `IDEMPOTENCY_TTL_SECONDS`: 7 days.
- `EVENT_STATE_TTL_SECONDS`: 7 days.
- `OUTBOX_TTL_SECONDS`: 7 days.
- `INCIDENT_EVENTS_TTL_SECONDS`: 7 days.

## Repository Structure

```
infra/            SAM template + OpenAPI spec
services/         Lambda handlers (ingest, incident engine, outbox, notification, incident API)
libs/             Shared libraries (logging, config, validation, DynamoDB helpers, domain)
scripts/          Demo event generator + DLQ replay tool
tests/            Jest tests (unit + integration stub)
```

## Deploy (AWS SAM)

```bash
npm install
sam build -t infra/template.yaml
sam deploy --guided -t infra/template.yaml
```

Required parameters:

- `CognitoUserPoolId` (required for `Stage=prod`; optional for dev)

Optional parameters:

- `Stage` (default: prod)
- `CorsAllowOrigin` (default: `*`)
- `SlackWorkspaceId` + `SlackChannelId` (optional; enables Slack alerts via AWS Chatbot)
- `AlarmEmail` (optional; sends alarms to email in addition to Slack)
- `IncidentNotificationEmail` (optional; email for incident notifications)
- `IngestRequiresAuth` (default: false; enforce JWT on `/v1/events`)
- `ApiThrottleRateLimit` / `ApiThrottleBurstLimit` (API Gateway throttling)

## Local Dev

```bash
npm install
sam build -t infra/template.yaml
sam local start-api -t infra/template.yaml --parameter-overrides CognitoUserPoolId=<user-pool-id>
```

When running without Cognito in dev, set `Stage=dev` and omit `CognitoUserPoolId`.

## Web UI

```bash
npm install
npm run web:dev
```

Environment variables:

- `VITE_API_BASE_URL` (default: `http://localhost:3000`)
- `VITE_AUTH_TOKEN` (optional JWT for protected endpoints)
- `VITE_TENANT_ID` (default tenant for API calls)

## Demo

```bash
export API_BASE_URL=http://localhost:3000
export TENANT_ID=demo
npm run demo
```

This script sends a burst of events with the same fingerprint to demonstrate deduplication and
severity escalation, then queries open incidents.

## DLQ Replay Tool

```bash
npm run replay-dlq -- --dlq-url <DLQ_URL> --target-queue-url <EVENTS_QUEUE_URL> --max 10 --dry-run
```

Options:

- `--requeue-to queue|eventbridge` (default: queue)
- `--event-bus <bus-name>` (required for EventBridge replay)
- `--force` to ignore replay safeguards

The tool marks replayed messages with `replayed=true` and increments `replayCount` to avoid loops.

## Testing

```bash
npm test
```

Integration stub (optional):

```bash
export INTEGRATION_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/<stage>
export INTEGRATION_AUTH_TOKEN=<jwt>
npm test
```

## Load Testing

```bash
LOAD_TEST_URL=https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/v1/incidents?status=OPEN \
LOAD_TEST_AUTH_TOKEN=<jwt> \
LOAD_TEST_TENANT_ID=<tenant-id> \
npm run load-test
```

## Failure Scenarios

- **Duplicate ingestion requests**: Idempotency table returns prior response without republishing.
- **Processor crashes mid-batch**: SQS retries failed messages; partial failures are reported.
- **Poison messages**: After max receives, messages land in `events-dlq` or `notifications-dlq` for inspection/replay.
- **Outbox publish failure**: Events stay in outbox until the publisher succeeds.
- **Partial outage**: Incident engine can continue correlating events even if notifications lag.

## Observability

- **Structured logs**: JSON logs include `requestId`, `correlationId`, `eventId`, and `incidentId`.
- **Metrics**: `events_ingested`, `events_deduplicated`, `incidents_opened`, `incidents_escalated`,
  `processing_latency_ms` (tagged by tenant and source where applicable).
- **Tracing**: X-Ray tracing enabled for all Lambdas (SAM `Tracing: Active`).
- **Alerts**: CloudWatch alarms route to SNS (Slack via AWS Chatbot when configured).

## OpenAPI

See `infra/openapi.yaml` for the ingestion and incident APIs.

## Operations

See `docs/RUNBOOK.md` for on-call flows, alarm triage, and recovery steps.

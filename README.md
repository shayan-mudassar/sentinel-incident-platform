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

## Idempotency & Deduplication

- **Ingestion idempotency**: `eventId` is stored in the Idempotency table with TTL. Replays return
  the same response and do not republish to EventBridge.
- **Processing idempotency**: The incident engine writes a `EVENT#<eventId>` record into EventState
  with TTL to avoid double-counting on retries.
- **Deduplication**: Events with the same `(env, source, fingerprint)` within `DEDUP_WINDOW_MS`
  increment a counter; only the first event in the window is processed and the rest are suppressed.

## Correlation & Severity

- **Correlation key**: `(env, source, fingerprint)` controls which incident receives new events.
  Active incidents are tracked by a pointer item so concurrent processors avoid creating duplicates.
- **Severity**: Start with `severityHint` (if provided) and then escalate if the count in the
  current window crosses thresholds (defaults in `libs/config/src/rules.ts`).
  Rules can be overridden by writing a `ruleId=default` item into the `Rules` table.

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

- `CognitoUserPoolId` (Cognito user pool id for JWT authorizer; must override the placeholder)

Optional parameters:

- `Stage` (default: prod)
- `CorsAllowOrigin` (default: `*`)
- `SlackWorkspaceId` + `SlackChannelId` (optional; enables Slack alerts via AWS Chatbot)
- `AlarmEmail` (optional; sends alarms to email in addition to Slack)

## Local Dev

```bash
npm install
sam build -t infra/template.yaml
sam local start-api -t infra/template.yaml --parameter-overrides CognitoUserPoolId=<user-pool-id>
```

## Web UI

```bash
npm install
npm run web:dev
```

Environment variables:

- `VITE_API_BASE_URL` (default: `http://localhost:3000`)
- `VITE_AUTH_TOKEN` (optional JWT for protected endpoints)

## Demo

```bash
export API_BASE_URL=http://localhost:3000
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
npm run load-test
```

## Failure Scenarios

- **Duplicate ingestion requests**: Idempotency table returns prior response without republishing.
- **Processor crashes mid-batch**: SQS retries failed messages; partial failures are reported.
- **Poison messages**: After max receives, messages land in `events-dlq` for inspection/replay.
- **Outbox publish failure**: Events stay in outbox until the publisher succeeds.
- **Partial outage**: Incident engine can continue correlating events even if notifications lag.

## Observability

- **Structured logs**: JSON logs include `requestId`, `correlationId`, `eventId`, and `incidentId`.
- **Metrics**: `events_ingested`, `events_deduplicated`, `incidents_opened`, `incidents_escalated`,
  `processing_latency_ms`.
- **Tracing**: X-Ray tracing enabled for all Lambdas (SAM `Tracing: Active`).
- **Alerts**: CloudWatch alarms route to SNS (Slack via AWS Chatbot when configured).

## OpenAPI

See `infra/openapi.yaml` for the ingestion and incident APIs.

## Operations

See `docs/RUNBOOK.md` for on-call flows, alarm triage, and recovery steps.

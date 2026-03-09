# Metrics

## Service Metrics Endpoint
`GET /metrics` returns:
- `uptimeSeconds`
- `version` (from `GIT_SHA` or `VERSION` env)
- `timestamp`

## Tenant Metrics Endpoint
`GET /v1/metrics` returns per-tenant counters when `METRICS_TABLE_NAME` is configured:
- `metrics.ingested`
- `metrics.deduped`

If metrics are not configured, the endpoint returns `501`.

## CloudWatch (Source of Truth)
- Structured JSON logs are emitted from all Lambdas.
- EMF metrics are emitted for key signals:
  - `events_ingested`
  - `events_deduplicated`
  - `incidents_opened`
  - `incidents_escalated`
  - `processing_latency_ms`
  - `ai_analysis_started`
  - `ai_analysis_completed`
  - `ai_analysis_failed`
  - `ai_analysis_skipped`
  - `ai_analysis_latency_ms`

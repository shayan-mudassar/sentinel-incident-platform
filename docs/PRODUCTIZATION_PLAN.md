# Sentinel Productization Plan

## Current Architecture Summary

- **Ingress**: API Gateway `/v1/events` -> Ingest Lambda (validation + idempotency) -> EventBridge.
- **Processing**: EventBridge -> SQS `events-queue` -> Incident Engine Lambda (dedup + correlate + severity) -> DynamoDB (Incidents, IncidentEvents, EventState, Outbox, Rules).
- **Notifications**: Outbox Publisher -> EventBridge -> SQS `notifications-queue` -> Notification Worker Lambda.
- **Incident API**: API Gateway `/v1/incidents` for list/detail/ack/resolve.
- **Observability**: structured JSON logs, EMF metrics, X-Ray tracing.

## Gaps For Service Readiness

### Security & Auth
- Cognito authorizer configuration is inconsistent and required even in dev.
- No explicit auth error handling in handlers for dev-mode.
- API Gateway lacks throttling/usage guardrails.

### Tenancy
- No tenant identifier flow; data is not tenant-scoped.
- Dedup/correlation and idempotency can collide across tenants.

### Operations & Guardrails
- Notification routing is not configurable per tenant.
- Notifications queue lacks DLQ for operational safety.
- TTLs and tenant overrides are not documented or configurable by tenant.

### UX & API Ergonomics
- Incident list lacks paging, time range filters, and severity filters.
- No incident timeline endpoint.
- UI lacks timeline and metrics, and does not capture tenant.

### Cost Hygiene
- Potential for unbounded queries if filters expand; need explicit limits and key-based queries.

## Implementation Plan (Ordered)

1. **Tenant propagation + data model scoping**
   - Add `X-Tenant-Id` requirement in ingress + incident APIs.
   - Prefix DynamoDB keys with tenant ID; update dedup/correlation/idempotency keys.
   - Ensure EventBridge detail includes tenant.
   - **Acceptance**: Requests without tenant ID return 400; no cross-tenant incident visibility; dedup/correlation scoped by tenant.

2. **Auth enforcement & dev gating**
   - Make Cognito optional in non-prod; required in prod.
   - Enforce JWT on incident APIs when Cognito configured; optional for ingestion.
   - Add explicit 401 responses in handlers when auth is required but missing.
   - **Acceptance**: `Stage=prod` requires Cognito; dev can run without; missing auth yields 401.

3. **Notification routing + real outbound channels**
   - Add `NotificationTargets` table: tenant + severity -> SNS topic(s).
   - Add notifications SNS topic + optional email subscription.
   - Implement SNS publish in notification worker with tenant routing and message attributes.
   - Add notifications DLQ and retry hooks.
   - **Acceptance**: Tenant-specific routing works; email notifications deliver via SNS; Slack works via Chatbot-configured topics.

4. **Incident lifecycle & API ergonomics**
   - Normalize statuses to `OPEN`, `ACKED`, `RESOLVED`.
   - Make ACK/RESOLVE idempotent.
   - Add paging + filters (status, severity, time range) and timeline endpoint.
   - **Acceptance**: List supports `limit`/`nextToken` + filters; timeline endpoint returns events; idempotent actions return 200.

5. **UI updates for credible demo**
   - Capture tenant ID, list open incidents, show detail + timeline, and ack/resolve.
   - Display basic metrics (ingested/deduped) if available.
   - **Acceptance**: UI performs end-to-end flow with tenant set; timeline visible; metrics show counts.

6. **Operational guardrails**
   - Add API Gateway throttling defaults.
   - Document TTLs and tenant overrides for dedup/severity rules.
   - **Acceptance**: Throttling configured in SAM; runbook/docs updated with TTLs + overrides.

7. **Testing expansion**
   - Add tests for tenant isolation, idempotency, dedup behavior, severity escalation, auth enforcement, and idempotent ACK/RESOLVE.
   - **Acceptance**: Jest suite covers new behaviors with mocked AWS SDK calls.

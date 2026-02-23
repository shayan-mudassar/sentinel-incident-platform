# Rate Limiting & Abuse Protection

## API Gateway Throttling
Configured in `infra/template.yaml`:
- `ApiThrottleBurstLimit` (default 100)
- `ApiThrottleRateLimit` (default 50 req/sec)

These apply to all methods on the API stage.

## WAF Rules
The API is protected by AWS Managed WAF rules:
- CommonRuleSet
- KnownBadInputsRuleSet
- SQLiRuleSet

## Ingest API Key (Optional)
- If `INGEST_API_KEY` is set on the ingest Lambda, unauthenticated ingestion requests must include:
  - `X-API-KEY: <value>`
- Authenticated requests (valid JWT) do not require the API key.

## Recommendations
- Keep tighter throttles on `/v1/events` if public ingestion is enabled.
- For tenant-specific rate limits, consider usage plans or per-tenant API keys.

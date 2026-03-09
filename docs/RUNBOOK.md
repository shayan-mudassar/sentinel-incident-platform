# Sentinel Runbook

## Alerting Channels

- CloudWatch alarms publish to SNS.
- Slack alerts are delivered via AWS Chatbot when `SlackWorkspaceId` and `SlackChannelId` are set.
- Optional email subscription via `AlarmEmail`.
- Incident notifications publish to tenant-specific SNS topics (configured in `NotificationTargets`).

## Primary Alerts

- **Events DLQ has messages**: `sentinel-<stage>-events-dlq-visible`
- **Events queue age high**: `sentinel-<stage>-events-queue-age`
- **Notifications queue age high**: `sentinel-<stage>-notifications-queue-age`
- **Notifications DLQ has messages**: `sentinel-<stage>-notifications-dlq-visible`
- **Lambda errors**: per-function error alarms

## Triage Checklist

1. Check API health (`GET /health`) and recent deploys.
2. Inspect CloudWatch logs for the failing function.
3. Review SQS queue metrics to isolate backlog vs. error. AI enrichment enabled: check
   `sentinel-<stage>-ai-analysis-queue` and `sentinel-<stage>-ai-analysis-dlq`.
4. If DLQ has messages, inspect payloads and decide whether to replay.
5. Validate EventBridge bus and outbox publisher activity.

## DLQ Replay

- Use `npm run replay-dlq -- --dlq-url <DLQ_URL> --target-queue-url <EVENTS_QUEUE_URL> --max 10 --dry-run`.
- Remove `--dry-run` after verifying payloads.
- Messages are marked with `replayed=true` and `replayCount` to avoid loops.

## Incident Lifecycle

- **ACKED** when a responder has taken ownership.
- **RESOLVE** once the root cause is addressed and impact has ended.
- For failed resolves, re-open by sending a new event with the same fingerprint.

## Notification Targets

- Notifications are routed by `NotificationTargets` table items:
  - `pk = TENANT#<tenantId>`
  - `sk = SEVERITY#<severity>` or `SEVERITY#ALL`
  - `targets = [{ type: \"SNS\", topicArn: \"arn:...\" }]`
- Attach AWS Chatbot Slack configs or email subscriptions to the SNS topics.

## Disaster Recovery

- DynamoDB tables have point-in-time recovery enabled in production.
- Use PITR to restore to a new table, then update stack parameters as needed.

## Security & Edge Protection

- WAF managed rules protect the API; tune rules as traffic patterns stabilize.
- Keep CORS locked to known UI origins in production.

## On-Call Routing

- Establish a primary + secondary rotation.
- Document escalation paths and expected response times.

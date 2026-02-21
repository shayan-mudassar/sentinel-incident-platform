export type SentinelConfig = {
  stage: string;
  defaultEnv: string;
  eventBusName: string;
  eventsQueueUrl: string;
  notificationsQueueUrl: string;
  incidentsTableName: string;
  eventStateTableName: string;
  outboxTableName: string;
  incidentEventsTableName: string;
  idempotencyTableName: string;
  notificationTargetsTableName?: string;
  metricsTableName?: string;
  rulesTableName?: string;
  dedupWindowMs: number;
  severityWindowMs: number;
  idempotencyTtlSeconds: number;
  eventStateTtlSeconds: number;
  processingTimeoutSeconds: number;
  outboxTtlSeconds: number;
  incidentEventsTtlSeconds: number;
  authRequired: boolean;
  ingestAuthRequired: boolean;
};

const numberFromEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isNaN(value) ? fallback : value;
};

export const getConfig = (): SentinelConfig => {
  const authRequiredRaw = process.env.AUTH_REQUIRED;
  const ingestAuthRequiredRaw = process.env.INGEST_AUTH_REQUIRED;
  return {
    stage: process.env.STAGE || 'dev',
    defaultEnv: process.env.DEFAULT_ENV || 'dev',
    eventBusName: process.env.EVENT_BUS_NAME || 'sentinel-bus',
    eventsQueueUrl: process.env.EVENTS_QUEUE_URL || '',
    notificationsQueueUrl: process.env.NOTIFICATIONS_QUEUE_URL || '',
    incidentsTableName: process.env.INCIDENTS_TABLE_NAME || 'Incidents',
    eventStateTableName: process.env.EVENT_STATE_TABLE_NAME || 'EventState',
    outboxTableName: process.env.OUTBOX_TABLE_NAME || 'Outbox',
    incidentEventsTableName: process.env.INCIDENT_EVENTS_TABLE_NAME || 'IncidentEvents',
    idempotencyTableName: process.env.IDEMPOTENCY_TABLE_NAME || 'Idempotency',
    notificationTargetsTableName: process.env.NOTIFICATION_TARGETS_TABLE_NAME,
    metricsTableName: process.env.METRICS_TABLE_NAME,
    rulesTableName: process.env.RULES_TABLE_NAME,
    dedupWindowMs: numberFromEnv('DEDUP_WINDOW_MS', 5 * 60 * 1000),
    severityWindowMs: numberFromEnv('SEVERITY_WINDOW_MS', 5 * 60 * 1000),
    idempotencyTtlSeconds: numberFromEnv('IDEMPOTENCY_TTL_SECONDS', 7 * 24 * 60 * 60),
    eventStateTtlSeconds: numberFromEnv('EVENT_STATE_TTL_SECONDS', 7 * 24 * 60 * 60),
    processingTimeoutSeconds: numberFromEnv('PROCESSING_TIMEOUT_SECONDS', 120),
    outboxTtlSeconds: numberFromEnv('OUTBOX_TTL_SECONDS', 7 * 24 * 60 * 60),
    incidentEventsTtlSeconds: numberFromEnv('INCIDENT_EVENTS_TTL_SECONDS', 7 * 24 * 60 * 60),
    authRequired: authRequiredRaw === 'true',
    ingestAuthRequired: ingestAuthRequiredRaw === 'true'
  };
};

export { defaultRules, loadRules, RulesConfig, SeverityRule } from './rules';

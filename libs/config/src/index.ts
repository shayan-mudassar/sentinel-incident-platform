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
  ingestApiKey?: string;
  aiEnabled: boolean;
  aiProvider: string;
  aiModel: string;
  aiTimeoutMs: number;
  aiMaxRetries: number;
  aiMinEventCountForAnalysis: number;
  aiReanalyzeOnIncidentUpdate: boolean;
  openaiApiKey?: string;
};

const numberFromEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isNaN(value) ? fallback : value;
};

const boolFromEnv = (name: string, fallback: boolean) => {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  return raw.toLowerCase() === 'true';
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
    idempotencyTtlSeconds: numberFromEnv('IDEMPOTENCY_TTL_SECONDS', 24 * 60 * 60),
    eventStateTtlSeconds: numberFromEnv('EVENT_STATE_TTL_SECONDS', 7 * 24 * 60 * 60),
    processingTimeoutSeconds: numberFromEnv('PROCESSING_TIMEOUT_SECONDS', 120),
    outboxTtlSeconds: numberFromEnv('OUTBOX_TTL_SECONDS', 7 * 24 * 60 * 60),
    incidentEventsTtlSeconds: numberFromEnv('INCIDENT_EVENTS_TTL_SECONDS', 7 * 24 * 60 * 60),
    authRequired: authRequiredRaw === 'true',
    ingestAuthRequired: ingestAuthRequiredRaw === 'true',
    ingestApiKey: process.env.INGEST_API_KEY,
    aiEnabled: boolFromEnv('AI_ENABLED', false),
    aiProvider: process.env.AI_PROVIDER || 'mock',
    aiModel: process.env.AI_MODEL || 'gpt-4o-mini',
    aiTimeoutMs: numberFromEnv('AI_TIMEOUT_MS', 4000),
    aiMaxRetries: numberFromEnv('AI_MAX_RETRIES', 2),
    aiMinEventCountForAnalysis: numberFromEnv('AI_MIN_EVENT_COUNT_FOR_ANALYSIS', 1),
    aiReanalyzeOnIncidentUpdate: boolFromEnv('AI_REANALYZE_ON_INCIDENT_UPDATE', false),
    openaiApiKey: process.env.OPENAI_API_KEY
  };
};

export { defaultRules, loadRules, RulesConfig, SeverityRule } from './rules';

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getEventBridgeClient } from '@sentinel/aws';
import { getConfig } from '@sentinel/config';
import { createLogger } from '@sentinel/logger';
import { emitMetrics } from '@sentinel/metrics';
import { validateIngestEvent } from '@sentinel/schemas';
import { buildIdempotencyKey, createIdempotencyStore } from '@sentinel/idempotency';
import { incrementTenantMetric } from '@sentinel/dynamodb';
import { getUserContextFromEvent } from '@sentinel/auth';
import {
  badRequest,
  getRequestId,
  getHeader,
  internalError,
  ok,
  parseTenantId,
  unauthorized
} from '@sentinel/http';

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const config = getConfig();
  const requestId = getRequestId(event) || context.awsRequestId;
  const logger = createLogger({
    requestId,
    service: 'ingest-api',
    route: `${event.httpMethod} ${event.path}`
  });
  const userContext = getUserContextFromEvent(event);
  const tenantId = parseTenantId(event.headers);

  if (!tenantId) {
    return badRequest('missing_tenant_id', 'Tenant id is required.', undefined, { requestId });
  }

  if (config.ingestAuthRequired && !userContext.isAuthenticated) {
    return unauthorized('auth_required', 'Authorization header is required.', { requestId });
  }

  const apiKey = config.ingestApiKey?.trim();
  if (apiKey && !userContext.isAuthenticated) {
    const providedKey = getHeader(event.headers, 'x-api-key');
    if (!providedKey || providedKey !== apiKey) {
      return unauthorized('api_key_required', 'Valid X-API-KEY is required.', { requestId });
    }
  }

  if (!event.body) {
    return badRequest('missing_body', 'Request body is required.', undefined, { requestId });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(event.body);
  } catch (error) {
    logger.warn('failed to parse event body', { error: String(error) });
    return badRequest('invalid_json', 'Request body must be valid JSON.', undefined, {
      requestId
    });
  }

  const validation = validateIngestEvent(payload);
  if (!validation.valid) {
    logger.info('event validation failed', { errors: validation.errors });
    return badRequest('invalid_event', 'Event payload failed validation.', validation.errors, {
      requestId
    });
  }

  const ingestEvent = validation.value;
  const idempotencyHeader = getHeader(event.headers, 'idempotency-key');
  const idempotencyKey = (idempotencyHeader || ingestEvent.idempotencyKey || ingestEvent.eventId).trim();
  if (!idempotencyKey) {
    return badRequest('missing_idempotency_key', 'Idempotency key is required.', undefined, {
      requestId
    });
  }
  const correlationHeader =
    event.headers['x-correlation-id'] || event.headers['X-Correlation-Id'];
  const correlationId = correlationHeader || ingestEvent.eventId || context.awsRequestId;
  const log = logger.withContext({
    correlationId,
    eventId: ingestEvent.eventId,
    source: ingestEvent.source,
    fingerprint: ingestEvent.fingerprint,
    tenantId
  });

  const idempotency = createIdempotencyStore(
    config.idempotencyTableName,
    config.idempotencyTtlSeconds
  );

  const idempotencyStoreKey = buildIdempotencyKey(tenantId, idempotencyKey);
  const startResult = await idempotency.start(idempotencyStoreKey, {
    tenantId,
    sourceEventId: ingestEvent.eventId
  });
  if (!startResult.started) {
    const existing = startResult.record;
    const responseBody = existing?.response || {
      status: existing?.status || 'duplicate',
      eventId: existing?.sourceEventId || ingestEvent.eventId,
      idempotencyKey
    };

    log.info('idempotent replay', { status: existing?.status });
    return ok({ ...responseBody, duplicate: true }, { requestId });
  }

  const env =
    typeof ingestEvent.attributes?.env === 'string'
      ? (ingestEvent.attributes.env as string)
      : config.defaultEnv;
  const detail = {
    ...ingestEvent,
    env,
    receivedAt: new Date().toISOString(),
    correlationId,
    tenantId,
    requestId,
    ownerUserId: userContext.userId
  };

  try {
    const eventBridge = getEventBridgeClient();
    const response = await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: config.eventBusName,
            Source: 'sentinel.ingest',
            DetailType: ingestEvent.type,
            Detail: JSON.stringify(detail)
          }
        ]
      })
    );

    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
      log.error('eventbridge put failed', { response });
      await idempotency.fail(idempotencyStoreKey, 'eventbridge_put_failed');
      return internalError('publish_failed', 'Failed to publish event.', { requestId });
    }

    const responseBody = {
      accepted: true,
      eventId: ingestEvent.eventId,
      status: 'published',
      idempotencyKey
    };

    await idempotency.complete(idempotencyStoreKey, responseBody);

    emitMetrics(
      'Sentinel',
      [{ name: 'events_ingested', unit: 'Count', value: 1 }],
      { service: 'ingest-api', source: ingestEvent.source, tenantId }
    );

    if (config.metricsTableName) {
      try {
        await incrementTenantMetric(config.metricsTableName, tenantId, 'ingested_total', 1);
      } catch (error) {
        log.warn('failed to update ingest metrics', { error: String(error) });
      }
    }

    log.info('event ingested');
    return ok(responseBody, { requestId });
  } catch (error) {
    log.error('failed to publish event', { error: String(error) });
    await idempotency.fail(idempotencyStoreKey, 'exception');
    return internalError('internal_error', 'Internal server error.', { requestId });
  }
};

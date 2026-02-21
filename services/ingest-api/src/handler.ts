import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getEventBridgeClient } from '@sentinel/aws';
import { getConfig } from '@sentinel/config';
import { createLogger } from '@sentinel/logger';
import { emitMetrics } from '@sentinel/metrics';
import { validateIngestEvent } from '@sentinel/schemas';
import { buildIdempotencyKey, createIdempotencyStore } from '@sentinel/idempotency';
import { incrementTenantMetric } from '@sentinel/dynamodb';
import { buildError, buildResponse, hasAuthHeader, parseTenantId } from '@sentinel/http';

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const config = getConfig();
  const logger = createLogger({ requestId: context.awsRequestId });
  const tenantId = parseTenantId(event.headers);

  if (!tenantId) {
    return buildError(400, 'validation_error', 'missing_tenant_id');
  }

  if (config.ingestAuthRequired && !hasAuthHeader(event.headers)) {
    return buildError(401, 'auth_required', 'missing_authorization');
  }

  if (!event.body) {
    return buildError(400, 'validation_error', 'missing_body');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(event.body);
  } catch (error) {
    logger.warn('failed to parse event body', { error: String(error) });
    return buildError(400, 'validation_error', 'invalid_json');
  }

  const validation = validateIngestEvent(payload);
  if (!validation.valid) {
    logger.info('event validation failed', { errors: validation.errors });
    return buildError(400, 'validation_error', 'invalid_event', validation.errors);
  }

  const ingestEvent = validation.value;
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

  const idempotencyKey = buildIdempotencyKey(tenantId, ingestEvent.eventId);
  const startResult = await idempotency.start(idempotencyKey, {
    tenantId,
    sourceEventId: ingestEvent.eventId
  });
  if (!startResult.started) {
    const existing = startResult.record;
    const responseBody = existing?.response || {
      status: existing?.status || 'duplicate',
      eventId: ingestEvent.eventId
    };

    log.info('idempotent replay', { status: existing?.status });
    return buildResponse(200, { ...responseBody, duplicate: true });
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
    tenantId
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
      await idempotency.fail(idempotencyKey, 'eventbridge_put_failed');
      return buildError(500, 'internal_error', 'publish_failed');
    }

    const responseBody = {
      accepted: true,
      eventId: ingestEvent.eventId,
      status: 'published'
    };

    await idempotency.complete(idempotencyKey, responseBody);

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
    return buildResponse(200, responseBody);
  } catch (error) {
    log.error('failed to publish event', { error: String(error) });
    await idempotency.fail(idempotencyKey, 'exception');
    return buildError(500, 'internal_error', 'internal_error');
  }
};

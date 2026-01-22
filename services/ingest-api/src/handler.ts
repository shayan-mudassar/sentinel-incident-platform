import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getEventBridgeClient } from '@sentinel/aws';
import { getConfig } from '@sentinel/config';
import { createLogger } from '@sentinel/logger';
import { emitMetrics } from '@sentinel/metrics';
import { validateIngestEvent } from '@sentinel/schemas';
import { createIdempotencyStore } from '@sentinel/idempotency';

const buildResponse = (statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  };
};

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const config = getConfig();
  const logger = createLogger({ requestId: context.awsRequestId });

  if (!event.body) {
    return buildResponse(400, { error: 'missing_body' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(event.body);
  } catch (error) {
    logger.warn('failed to parse event body', { error: String(error) });
    return buildResponse(400, { error: 'invalid_json' });
  }

  const validation = validateIngestEvent(payload);
  if (!validation.valid) {
    logger.info('event validation failed', { errors: validation.errors });
    return buildResponse(400, { error: 'invalid_event', details: validation.errors });
  }

  const ingestEvent = validation.value;
  const correlationHeader =
    event.headers['x-correlation-id'] || event.headers['X-Correlation-Id'];
  const correlationId = correlationHeader || ingestEvent.eventId || context.awsRequestId;
  const log = logger.withContext({
    correlationId,
    eventId: ingestEvent.eventId,
    source: ingestEvent.source,
    fingerprint: ingestEvent.fingerprint
  });

  const idempotency = createIdempotencyStore(
    config.idempotencyTableName,
    config.idempotencyTtlSeconds
  );

  const startResult = await idempotency.start(ingestEvent.eventId);
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
    correlationId
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
      await idempotency.fail(ingestEvent.eventId, 'eventbridge_put_failed');
      return buildResponse(500, { error: 'publish_failed' });
    }

    const responseBody = {
      accepted: true,
      eventId: ingestEvent.eventId,
      status: 'published'
    };

    await idempotency.complete(ingestEvent.eventId, responseBody);

    emitMetrics(
      'Sentinel',
      [{ name: 'events_ingested', unit: 'Count', value: 1 }],
      { service: 'ingest-api', source: ingestEvent.source }
    );

    log.info('event ingested');
    return buildResponse(200, responseBody);
  } catch (error) {
    log.error('failed to publish event', { error: String(error) });
    await idempotency.fail(ingestEvent.eventId, 'exception');
    return buildResponse(500, { error: 'internal_error' });
  }
};

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getConfig } from '@sentinel/config';
import { createLogger } from '@sentinel/logger';
import {
  deleteActivePointer,
  getIncidentById,
  listIncidents,
  updateActivePointer,
  updateIncident,
  putOutboxEvent
} from '@sentinel/dynamodb';
import { buildIncidentChangedDetail } from '@sentinel/events';
import { IncidentStatus } from '@sentinel/domain';

const buildResponse = (statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

const parseIncidentId = (path: string) => {
  const match = path.match(/^\/v1\/incidents\/([^/]+)$/);
  return match ? match[1] : undefined;
};

const parseAction = (path: string) => {
  const match = path.match(/^\/v1\/incidents\/([^/]+)\/(ack|resolve)$/);
  return match ? { incidentId: match[1], action: match[2] } : undefined;
};

const isConditionalCheckFailed = (error: unknown) => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'ConditionalCheckFailedException'
  );
};

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const config = getConfig();
  const correlationId =
    event.headers['x-correlation-id'] || event.headers['X-Correlation-Id'] || context.awsRequestId;
  const logger = createLogger({ requestId: context.awsRequestId, correlationId, service: 'incident-api' });

  if (event.httpMethod === 'GET' && event.path === '/v1/incidents') {
    const status = (event.queryStringParameters?.status || 'OPEN').toUpperCase() as IncidentStatus;
    const source = event.queryStringParameters?.source;
    const env = event.queryStringParameters?.env;
    const incidents = await listIncidents(config.incidentsTableName, status, source, env);
    return buildResponse(200, { items: incidents });
  }

  if (event.httpMethod === 'GET') {
    const incidentId = parseIncidentId(event.path);
    if (!incidentId) {
      return buildResponse(404, { error: 'not_found' });
    }

    const incident = await getIncidentById(config.incidentsTableName, incidentId);
    if (!incident) {
      return buildResponse(404, { error: 'not_found' });
    }

    return buildResponse(200, { incident });
  }

  if (event.httpMethod === 'POST') {
    const action = parseAction(event.path);
    if (!action) {
      return buildResponse(404, { error: 'not_found' });
    }

    const incident = await getIncidentById(config.incidentsTableName, action.incidentId);
    if (!incident) {
      return buildResponse(404, { error: 'not_found' });
    }

    const updatedAt = new Date().toISOString();
    const nextVersion = incident.version + 1;
    const status: IncidentStatus = action.action === 'ack' ? 'ACK' : 'RESOLVED';

    try {
      await updateIncident(
        config.incidentsTableName,
        incident.incidentId,
        {
          status,
          severity: incident.severity,
          lastEventAt: incident.lastEventAt,
          updatedAt,
          eventCount: incident.eventCount,
          version: nextVersion,
          source: incident.source,
          env: incident.env
        },
        incident.version
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        logger.info('incident update conflict', { incidentId: incident.incidentId });
        return buildResponse(409, { error: 'conflict' });
      }
      throw error;
    }

    if (status === 'RESOLVED') {
      await deleteActivePointer(config.incidentsTableName, incident.env, incident.source, incident.fingerprint);
    } else {
      await updateActivePointer(config.incidentsTableName, incident.env, incident.source, incident.fingerprint, status);
    }

    await putOutboxEvent(config.outboxTableName, {
      outboxId: `INCIDENT#${incident.incidentId}#${nextVersion}`,
      status: 'PENDING',
      eventType: 'IncidentChanged',
      source: 'sentinel.incident',
      detail: buildIncidentChangedDetail(
        { ...incident, status, updatedAt, version: nextVersion },
        status === 'ACK' ? 'ACKED' : 'RESOLVED',
        correlationId
      ),
      createdAt: updatedAt,
      expiresAt: Math.floor((Date.now() + config.outboxTtlSeconds * 1000) / 1000)
    });

    logger.info('incident status updated', { incidentId: incident.incidentId, status });

    return buildResponse(200, { incidentId: incident.incidentId, status });
  }

  return buildResponse(404, { error: 'not_found' });
};

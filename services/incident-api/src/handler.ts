import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getConfig } from '@sentinel/config';
import { createLogger } from '@sentinel/logger';
import {
  deleteActivePointer,
  getIncidentById,
  getTenantMetrics,
  listIncidents,
  listIncidentEvents,
  updateActivePointer,
  updateIncident,
  putOutboxEvent
} from '@sentinel/dynamodb';
import { buildIncidentChangedDetail } from '@sentinel/events';
import { IncidentStatus, Severity } from '@sentinel/domain';
import { buildError, buildResponse, hasAuthHeader, parseTenantId } from '@sentinel/http';

const parseIncidentId = (path: string) => {
  const match = path.match(/^\/v1\/incidents\/([^/]+)$/);
  return match ? match[1] : undefined;
};

const parseIncidentEvents = (path: string) => {
  const match = path.match(/^\/v1\/incidents\/([^/]+)\/events$/);
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

const normalizeStatus = (raw?: string | null): IncidentStatus | undefined => {
  if (!raw) {
    return undefined;
  }
  const upper = raw.toUpperCase();
  if (upper === 'ACK') {
    return 'ACKED';
  }
  if (upper === 'ACKED' || upper === 'OPEN' || upper === 'RESOLVED') {
    return upper as IncidentStatus;
  }
  return undefined;
};

const normalizeSeverity = (raw?: string | null): Severity | undefined => {
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  if (lower === 'low' || lower === 'medium' || lower === 'high' || lower === 'critical') {
    return lower as Severity;
  }
  return undefined;
};

const toIsoIfValid = (value?: string | null) => {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
};

const encodePageToken = (value?: Record<string, unknown>) => {
  if (!value) {
    return undefined;
  }
  return Buffer.from(JSON.stringify(value)).toString('base64url');
};

const decodePageToken = (value?: string | null) => {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const config = getConfig();
  const correlationId =
    event.headers['x-correlation-id'] || event.headers['X-Correlation-Id'] || context.awsRequestId;
  const logger = createLogger({ requestId: context.awsRequestId, correlationId, service: 'incident-api' });
  const tenantId = parseTenantId(event.headers);

  if (!tenantId) {
    return buildError(400, 'validation_error', 'missing_tenant_id');
  }

  if (config.authRequired && !hasAuthHeader(event.headers)) {
    return buildError(401, 'auth_required', 'missing_authorization');
  }

  const log = logger.withContext({ tenantId });

  if (event.httpMethod === 'GET' && event.path === '/v1/incidents') {
    const statusRaw = event.queryStringParameters?.status;
    const status = normalizeStatus(statusRaw) || (statusRaw ? undefined : ('OPEN' as IncidentStatus));
    if (!status) {
      return buildError(400, 'validation_error', 'invalid_status');
    }
    const severity = normalizeSeverity(event.queryStringParameters?.severity);
    if (event.queryStringParameters?.severity && !severity) {
      return buildError(400, 'validation_error', 'invalid_severity');
    }

    const from = toIsoIfValid(event.queryStringParameters?.from);
    if (event.queryStringParameters?.from && !from) {
      return buildError(400, 'validation_error', 'invalid_from');
    }

    const to = toIsoIfValid(event.queryStringParameters?.to);
    if (event.queryStringParameters?.to && !to) {
      return buildError(400, 'validation_error', 'invalid_to');
    }
    if (from && to && from > to) {
      return buildError(400, 'validation_error', 'invalid_range');
    }

    const limitRaw = event.queryStringParameters?.limit;
    const limit = limitRaw ? Number(limitRaw) : undefined;
    if (limitRaw && (!Number.isInteger(limit) || (limit || 0) <= 0 || (limit || 0) > 100)) {
      return buildError(400, 'validation_error', 'invalid_limit');
    }

    const source = event.queryStringParameters?.source;
    const env = event.queryStringParameters?.env;
    const nextToken = decodePageToken(event.queryStringParameters?.nextToken);
    if (event.queryStringParameters?.nextToken && !nextToken) {
      return buildError(400, 'validation_error', 'invalid_next_token');
    }

    const response = await listIncidents(config.incidentsTableName, {
      tenantId,
      status,
      source,
      env,
      severity,
      from,
      to,
      limit,
      nextToken
    });
    return buildResponse(200, { items: response.items, nextToken: encodePageToken(response.nextToken) });
  }

  if (event.httpMethod === 'GET' && event.path === '/v1/metrics') {
    if (!config.metricsTableName) {
      return buildError(501, 'internal_error', 'metrics_not_configured');
    }
    const metrics = await getTenantMetrics(config.metricsTableName, tenantId, [
      'ingested_total',
      'deduped_total'
    ]);
    const epoch = new Date(0).toISOString();
    const updatedAt: Record<string, string> = {};
    if (metrics.ingested_total.updatedAt && metrics.ingested_total.updatedAt !== epoch) {
      updatedAt.ingested = metrics.ingested_total.updatedAt;
    }
    if (metrics.deduped_total.updatedAt && metrics.deduped_total.updatedAt !== epoch) {
      updatedAt.deduped = metrics.deduped_total.updatedAt;
    }
    const responseBody: Record<string, unknown> = {
      metrics: {
        ingested: metrics.ingested_total.count,
        deduped: metrics.deduped_total.count
      }
    };
    if (Object.keys(updatedAt).length > 0) {
      responseBody.updatedAt = updatedAt;
    }
    return buildResponse(200, responseBody);
  }

  if (event.httpMethod === 'GET') {
    const incidentIdFromEvents = parseIncidentEvents(event.path);
    if (incidentIdFromEvents) {
      const limitRaw = event.queryStringParameters?.limit;
      const limit = limitRaw ? Number(limitRaw) : undefined;
      if (limitRaw && (!Number.isInteger(limit) || (limit || 0) <= 0 || (limit || 0) > 100)) {
        return buildError(400, 'validation_error', 'invalid_limit');
      }
      const nextToken = decodePageToken(event.queryStringParameters?.nextToken);
      if (event.queryStringParameters?.nextToken && !nextToken) {
        return buildError(400, 'validation_error', 'invalid_next_token');
      }

      const result = await listIncidentEvents(config.incidentEventsTableName, {
        tenantId,
        incidentId: incidentIdFromEvents,
        limit,
        nextToken
      });
      return buildResponse(200, {
        items: result.items,
        nextToken: encodePageToken(result.nextToken)
      });
    }

    const incidentIdFromPath = parseIncidentId(event.path);
    if (!incidentIdFromPath) {
      return buildError(404, 'not_found');
    }

    const incident = await getIncidentById(config.incidentsTableName, tenantId, incidentIdFromPath);
    if (!incident) {
      return buildError(404, 'not_found');
    }

    return buildResponse(200, { incident });
  }

  if (event.httpMethod === 'POST') {
    const action = parseAction(event.path);
    if (!action) {
      return buildError(404, 'not_found');
    }

    const incident = await getIncidentById(config.incidentsTableName, tenantId, action.incidentId);
    if (!incident) {
      return buildError(404, 'not_found');
    }

    const status: IncidentStatus = action.action === 'ack' ? 'ACKED' : 'RESOLVED';

    if (incident.status === status) {
      return buildResponse(200, { incidentId: incident.incidentId, status, idempotent: true });
    }

    if (status === 'ACKED' && incident.status === 'RESOLVED') {
      return buildError(409, 'conflict', 'invalid_state');
    }

    const updatedAt = new Date().toISOString();
    const nextVersion = incident.version + 1;

    try {
      await updateIncident(
        config.incidentsTableName,
        tenantId,
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
        log.info('incident update conflict', { incidentId: incident.incidentId });
        return buildError(409, 'conflict', 'conflict');
      }
      throw error;
    }

    if (status === 'RESOLVED') {
      await deleteActivePointer(
        config.incidentsTableName,
        tenantId,
        incident.env,
        incident.source,
        incident.fingerprint
      );
    } else {
      await updateActivePointer(
        config.incidentsTableName,
        tenantId,
        incident.env,
        incident.source,
        incident.fingerprint,
        status
      );
    }

    await putOutboxEvent(config.outboxTableName, {
      outboxId: `INCIDENT#${incident.incidentId}#${nextVersion}`,
      status: 'PENDING',
      eventType: 'IncidentChanged',
      source: 'sentinel.incident',
      detail: buildIncidentChangedDetail(
        { ...incident, status, updatedAt, version: nextVersion },
        status === 'ACKED' ? 'ACKED' : 'RESOLVED',
        correlationId
      ),
      createdAt: updatedAt,
      expiresAt: Math.floor((Date.now() + config.outboxTtlSeconds * 1000) / 1000)
    });

    log.info('incident status updated', { incidentId: incident.incidentId, status });

    return buildResponse(200, { incidentId: incident.incidentId, status });
  }

  return buildError(404, 'not_found');
};

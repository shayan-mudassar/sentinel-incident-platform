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
import { getUserContextFromEvent, isAdmin, requireAuth } from '@sentinel/auth';
import {
  badRequest,
  conflict,
  getRequestId,
  forbidden,
  notFound,
  notImplemented,
  ok,
  parseTenantId,
  unauthorized
} from '@sentinel/http';

const STARTED_AT = Date.now();

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
  const requestId = getRequestId(event) || context.awsRequestId;
  const correlationId =
    event.headers['x-correlation-id'] || event.headers['X-Correlation-Id'] || requestId;
  const logger = createLogger({
    requestId,
    correlationId,
    service: 'incident-api',
    route: `${event.httpMethod} ${event.path}`
  });
  const userContext = getUserContextFromEvent(event);
  if (event.httpMethod === 'GET' && event.path === '/health') {
    return ok(
      {
        status: 'ok',
        service: 'sentinel',
        timestamp: new Date().toISOString()
      },
      { requestId }
    );
  }

  if (event.httpMethod === 'GET' && event.path === '/metrics') {
    const version = process.env.GIT_SHA || process.env.VERSION || 'unknown';
    const uptimeSeconds = Math.floor((Date.now() - STARTED_AT) / 1000);
    return ok(
      {
        service: 'sentinel',
        version,
        uptimeSeconds,
        timestamp: new Date().toISOString()
      },
      { requestId }
    );
  }
  const tenantId = parseTenantId(event.headers);

  if (!tenantId) {
    return badRequest('missing_tenant_id', 'Tenant id is required.', undefined, { requestId });
  }

  if (config.authRequired && !requireAuth(userContext)) {
    return unauthorized('auth_required', 'Authorization header is required.', { requestId });
  }
  const isAdminUser = isAdmin(userContext);

  const log = logger.withContext({ tenantId });

  if (event.httpMethod === 'GET' && event.path === '/v1/incidents') {
    const statusRaw = event.queryStringParameters?.status;
    const status = normalizeStatus(statusRaw) || (statusRaw ? undefined : ('OPEN' as IncidentStatus));
    if (!status) {
      return badRequest('invalid_status', 'Status must be OPEN, ACKED, or RESOLVED.', undefined, { requestId });
    }
    const severity = normalizeSeverity(event.queryStringParameters?.severity);
    if (event.queryStringParameters?.severity && !severity) {
      return badRequest(
        'invalid_severity',
        'Severity must be low, medium, high, or critical.',
        undefined,
        { requestId }
      );
    }

    const from = toIsoIfValid(event.queryStringParameters?.from);
    if (event.queryStringParameters?.from && !from) {
      return badRequest('invalid_from', 'From must be a valid ISO date-time.', undefined, {
        requestId
      });
    }

    const to = toIsoIfValid(event.queryStringParameters?.to);
    if (event.queryStringParameters?.to && !to) {
      return badRequest('invalid_to', 'To must be a valid ISO date-time.', undefined, { requestId });
    }
    if (from && to && from > to) {
      return badRequest('invalid_range', 'From must be earlier than to.', undefined, { requestId });
    }

    const pageSizeRaw = event.queryStringParameters?.pageSize ?? event.queryStringParameters?.limit;
    const limit = pageSizeRaw ? Number(pageSizeRaw) : undefined;
    if (pageSizeRaw && (!Number.isInteger(limit) || (limit || 0) <= 0 || (limit || 0) > 100)) {
      return badRequest('invalid_page_size', 'pageSize must be between 1 and 100.', undefined, {
        requestId
      });
    }

    const source = event.queryStringParameters?.source;
    const env = event.queryStringParameters?.env;
    const nextToken = decodePageToken(event.queryStringParameters?.nextToken);
    if (event.queryStringParameters?.nextToken && !nextToken) {
      return badRequest('invalid_next_token', 'nextToken must be a valid page token.', undefined, {
        requestId
      });
    }

    const response = await listIncidents(config.incidentsTableName, {
      tenantId,
      status,
      source,
      env,
      severity,
      ownerUserId: userContext.isAuthenticated && !isAdminUser ? userContext.userId : undefined,
      from,
      to,
      limit,
      nextToken
    });
    return ok(
      {
        items: response.items,
        nextToken: encodePageToken(response.nextToken),
        pageSize: limit || response.items.length
      },
      { requestId }
    );
  }

  if (event.httpMethod === 'GET' && event.path === '/v1/metrics') {
    if (!config.metricsTableName) {
      return notImplemented('metrics_not_configured', 'Metrics are not configured.', { requestId });
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
    return ok(responseBody as Record<string, unknown>, { requestId });
  }

  if (event.httpMethod === 'GET') {
    const incidentIdFromEvents = parseIncidentEvents(event.path);
    if (incidentIdFromEvents) {
      const pageSizeRaw = event.queryStringParameters?.pageSize ?? event.queryStringParameters?.limit;
      const limit = pageSizeRaw ? Number(pageSizeRaw) : undefined;
      if (pageSizeRaw && (!Number.isInteger(limit) || (limit || 0) <= 0 || (limit || 0) > 100)) {
        return badRequest('invalid_page_size', 'pageSize must be between 1 and 100.', undefined, {
          requestId
        });
      }
      const nextToken = decodePageToken(event.queryStringParameters?.nextToken);
      if (event.queryStringParameters?.nextToken && !nextToken) {
        return badRequest('invalid_next_token', 'nextToken must be a valid page token.', undefined, {
          requestId
        });
      }

      if (userContext.isAuthenticated && !isAdminUser) {
        const incident = await getIncidentById(config.incidentsTableName, tenantId, incidentIdFromEvents);
        if (!incident) {
          return notFound('not_found', 'Incident not found.', { requestId });
        }
        if (incident.ownerUserId !== userContext.userId) {
          return forbidden('forbidden', 'You do not have access to this incident.', { requestId });
        }
      }

      const result = await listIncidentEvents(config.incidentEventsTableName, {
        tenantId,
        incidentId: incidentIdFromEvents,
        limit,
        nextToken
      });
      return ok(
        {
          items: result.items,
          nextToken: encodePageToken(result.nextToken),
          pageSize: limit || result.items.length
        },
        { requestId }
      );
    }

    const incidentIdFromPath = parseIncidentId(event.path);
    if (!incidentIdFromPath) {
      return notFound('not_found', 'Route not found.', { requestId });
    }

    const incident = await getIncidentById(config.incidentsTableName, tenantId, incidentIdFromPath);
    if (!incident) {
      return notFound('not_found', 'Incident not found.', { requestId });
    }
    if (userContext.isAuthenticated && !isAdminUser && incident.ownerUserId !== userContext.userId) {
      return forbidden('forbidden', 'You do not have access to this incident.', { requestId });
    }

    return ok({ incident }, { requestId });
  }

  if (event.httpMethod === 'POST') {
    const action = parseAction(event.path);
    if (!action) {
      return notFound('not_found', 'Route not found.', { requestId });
    }

    const incident = await getIncidentById(config.incidentsTableName, tenantId, action.incidentId);
    if (!incident) {
      return notFound('not_found', 'Incident not found.', { requestId });
    }
    if (userContext.isAuthenticated && !isAdminUser && incident.ownerUserId !== userContext.userId) {
      return forbidden('forbidden', 'You do not have access to update this incident.', { requestId });
    }

    const status: IncidentStatus = action.action === 'ack' ? 'ACKED' : 'RESOLVED';

    if (incident.status === status) {
      return ok({ incidentId: incident.incidentId, status, idempotent: true }, { requestId });
    }

    if (status === 'ACKED' && incident.status === 'RESOLVED') {
      return conflict('invalid_state', 'Cannot acknowledge a resolved incident.', { requestId });
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
        return conflict('conflict', 'Incident was updated by another request.', { requestId });
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
        correlationId,
        requestId
      ),
      createdAt: updatedAt,
      expiresAt: Math.floor((Date.now() + config.outboxTtlSeconds * 1000) / 1000)
    });

    log.info('incident status updated', { incidentId: incident.incidentId, status });

    return ok({ incidentId: incident.incidentId, status }, { requestId });
  }

  return notFound('not_found', 'Route not found.', { requestId });
};

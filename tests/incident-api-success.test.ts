export {};

const listIncidents = jest.fn();
const listIncidentEvents = jest.fn();
const getTenantMetrics = jest.fn();
const getIncidentById = jest.fn();
const updateIncident = jest.fn();
const updateActivePointer = jest.fn();
const deleteActivePointer = jest.fn();
const putOutboxEvent = jest.fn();

jest.mock('@sentinel/config', () => ({
  getConfig: () => ({
    incidentsTableName: 'Incidents',
    incidentEventsTableName: 'IncidentEvents',
    outboxTableName: 'Outbox',
    outboxTtlSeconds: 60,
    metricsTableName: 'Metrics',
    authRequired: false
  })
}));

jest.mock('@sentinel/dynamodb', () => ({
  listIncidents,
  listIncidentEvents,
  getTenantMetrics,
  getIncidentById,
  updateIncident,
  updateActivePointer,
  deleteActivePointer,
  putOutboxEvent
}));

const { handler } = require('../services/incident-api/src/handler');

const baseEvent = {
  headers: { 'X-Tenant-Id': 'tenant-1' },
  body: null,
  isBase64Encoded: false
};

describe('incident api success paths', () => {
  beforeEach(() => {
    listIncidents.mockReset();
    listIncidentEvents.mockReset();
    getTenantMetrics.mockReset();
    getIncidentById.mockReset();
    updateIncident.mockReset();
    updateActivePointer.mockReset();
    deleteActivePointer.mockReset();
    putOutboxEvent.mockReset();
  });

  it('lists incidents with default status', async () => {
    listIncidents.mockResolvedValueOnce({ items: [{ incidentId: 'inc-1' }], nextToken: { pk: 'next' } });

    const response = await handler(
      { ...baseEvent, httpMethod: 'GET', path: '/v1/incidents', queryStringParameters: null } as never,
      { awsRequestId: 'req-1' } as never
    );

    expect(response.statusCode).toBe(200);
    expect(listIncidents).toHaveBeenCalledWith(
      'Incidents',
      expect.objectContaining({ status: 'OPEN', tenantId: 'tenant-1' })
    );

    const payload = JSON.parse(response.body);
    const decoded = JSON.parse(Buffer.from(payload.nextToken, 'base64url').toString('utf8'));
    expect(decoded.pk).toBe('next');
  });

  it('lists incident events with paging token', async () => {
    listIncidentEvents.mockResolvedValueOnce({ items: [{ eventId: 'evt-1' }], nextToken: { sk: 'next' } });

    const response = await handler(
      {
        ...baseEvent,
        httpMethod: 'GET',
        path: '/v1/incidents/inc-1/events',
        queryStringParameters: { limit: '2' }
      } as never,
      { awsRequestId: 'req-2' } as never
    );

    expect(response.statusCode).toBe(200);
    expect(listIncidentEvents).toHaveBeenCalledWith(
      'IncidentEvents',
      expect.objectContaining({ incidentId: 'inc-1', limit: 2 })
    );
    const payload = JSON.parse(response.body);
    expect(payload.items).toHaveLength(1);
    expect(payload.nextToken).toBeDefined();
  });

  it('gets incident by id', async () => {
    getIncidentById.mockResolvedValueOnce({ incidentId: 'inc-1', status: 'OPEN' });

    const response = await handler(
      { ...baseEvent, httpMethod: 'GET', path: '/v1/incidents/inc-1' } as never,
      { awsRequestId: 'req-3' } as never
    );

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.incident.incidentId).toBe('inc-1');
  });

  it('returns metrics with updatedAt for non-epoch values', async () => {
    getTenantMetrics.mockResolvedValueOnce({
      ingested_total: { count: 5, updatedAt: '2024-01-02T00:00:00.000Z' },
      deduped_total: { count: 2, updatedAt: new Date(0).toISOString() }
    });

    const response = await handler(
      { ...baseEvent, httpMethod: 'GET', path: '/v1/metrics' } as never,
      { awsRequestId: 'req-4' } as never
    );

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.metrics.ingested).toBe(5);
    expect(payload.metrics.deduped).toBe(2);
    expect(payload.updatedAt.ingested).toBe('2024-01-02T00:00:00.000Z');
    expect(payload.updatedAt.deduped).toBeUndefined();
  });

  it('acks incident and emits outbox event', async () => {
    getIncidentById.mockResolvedValueOnce({
      incidentId: 'inc-1',
      tenantId: 'tenant-1',
      status: 'OPEN',
      source: 'svc',
      fingerprint: 'fp',
      env: 'prod',
      severity: 'low',
      openedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastEventAt: '2024-01-01T00:00:00.000Z',
      eventCount: 1,
      version: 1
    });

    const response = await handler(
      { ...baseEvent, httpMethod: 'POST', path: '/v1/incidents/inc-1/ack' } as never,
      { awsRequestId: 'req-5' } as never
    );

    expect(response.statusCode).toBe(200);
    expect(updateIncident).toHaveBeenCalledWith(
      'Incidents',
      'tenant-1',
      'inc-1',
      expect.objectContaining({ status: 'ACKED' }),
      1
    );
    expect(updateActivePointer).toHaveBeenCalledWith('Incidents', 'tenant-1', 'prod', 'svc', 'fp', 'ACKED');
    expect(deleteActivePointer).not.toHaveBeenCalled();
    const outbox = putOutboxEvent.mock.calls[0][1];
    expect(outbox.detail.changeType).toBe('ACKED');
  });

  it('resolves incident and clears active pointer', async () => {
    getIncidentById.mockResolvedValueOnce({
      incidentId: 'inc-2',
      tenantId: 'tenant-1',
      status: 'ACKED',
      source: 'svc',
      fingerprint: 'fp',
      env: 'prod',
      severity: 'high',
      openedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastEventAt: '2024-01-01T00:00:00.000Z',
      eventCount: 3,
      version: 7
    });

    const response = await handler(
      { ...baseEvent, httpMethod: 'POST', path: '/v1/incidents/inc-2/resolve' } as never,
      { awsRequestId: 'req-6' } as never
    );

    expect(response.statusCode).toBe(200);
    expect(updateIncident).toHaveBeenCalledWith(
      'Incidents',
      'tenant-1',
      'inc-2',
      expect.objectContaining({ status: 'RESOLVED' }),
      7
    );
    expect(deleteActivePointer).toHaveBeenCalledWith('Incidents', 'tenant-1', 'prod', 'svc', 'fp');
    const outbox = putOutboxEvent.mock.calls[0][1];
    expect(outbox.detail.changeType).toBe('RESOLVED');
  });
});

export {};

const listIncidents = jest.fn();
const getIncidentById = jest.fn();
const listIncidentEvents = jest.fn();

jest.mock('@sentinel/config', () => ({
  getConfig: () => ({
    incidentsTableName: 'Incidents',
    incidentEventsTableName: 'IncidentEvents',
    outboxTableName: 'Outbox',
    outboxTtlSeconds: 60,
    metricsTableName: 'Metrics',
    authRequired: true
  })
}));

jest.mock('@sentinel/dynamodb', () => ({
  listIncidents,
  listIncidentEvents,
  getIncidentById,
  updateIncident: jest.fn(),
  updateActivePointer: jest.fn(),
  deleteActivePointer: jest.fn(),
  putOutboxEvent: jest.fn(),
  getTenantMetrics: jest.fn()
}));

const { handler } = require('../services/incident-api/src/handler');

describe('incident api ownership rules', () => {
  beforeEach(() => {
    listIncidents.mockReset();
    listIncidentEvents.mockReset();
    getIncidentById.mockReset();
  });

  it('filters list incidents by owner for non-admin user', async () => {
    listIncidents.mockResolvedValueOnce({ items: [], nextToken: undefined });

    await handler(
      {
        httpMethod: 'GET',
        path: '/v1/incidents',
        headers: { 'X-Tenant-Id': 'tenant-1' },
        requestContext: { authorizer: { sub: 'user-1', roles: 'USER' } },
        body: null,
        isBase64Encoded: false
      } as never,
      { awsRequestId: 'req-1' } as never
    );

    expect(listIncidents).toHaveBeenCalledWith(
      'Incidents',
      expect.objectContaining({ ownerUserId: 'user-1' })
    );
  });

  it('forbids access when user is not owner', async () => {
    getIncidentById.mockResolvedValueOnce({
      incidentId: 'inc-1',
      tenantId: 'tenant-1',
      ownerUserId: 'other-user',
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
      {
        httpMethod: 'GET',
        path: '/v1/incidents/inc-1',
        headers: { 'X-Tenant-Id': 'tenant-1' },
        requestContext: { authorizer: { sub: 'user-1', roles: 'USER' } },
        body: null,
        isBase64Encoded: false
      } as never,
      { awsRequestId: 'req-2' } as never
    );

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe('forbidden');
  });

  it('allows admin to access any incident', async () => {
    getIncidentById.mockResolvedValueOnce({
      incidentId: 'inc-2',
      tenantId: 'tenant-1',
      ownerUserId: 'someone-else',
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
      {
        httpMethod: 'GET',
        path: '/v1/incidents/inc-2',
        headers: { 'X-Tenant-Id': 'tenant-1' },
        requestContext: { authorizer: { sub: 'admin', roles: 'ADMIN' } },
        body: null,
        isBase64Encoded: false
      } as never,
      { awsRequestId: 'req-3' } as never
    );

    expect(response.statusCode).toBe(200);
  });
});

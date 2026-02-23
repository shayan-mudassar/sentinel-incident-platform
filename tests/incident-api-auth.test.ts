import { handler } from '../services/incident-api/src/handler';
import { listIncidents } from '@sentinel/dynamodb';

jest.mock('@sentinel/config', () => ({
  getConfig: () => ({
    incidentsTableName: 'Incidents',
    outboxTableName: 'Outbox',
    outboxTtlSeconds: 60,
    incidentEventsTableName: 'IncidentEvents',
    metricsTableName: 'Metrics',
    authRequired: true
  })
}));

jest.mock('@sentinel/dynamodb', () => ({
  listIncidents: jest.fn(),
  getIncidentById: jest.fn(),
  updateIncident: jest.fn(),
  updateActivePointer: jest.fn(),
  deleteActivePointer: jest.fn(),
  putOutboxEvent: jest.fn(),
  listIncidentEvents: jest.fn(),
  getTenantMetrics: jest.fn()
}));

describe('incident-api auth', () => {
  beforeEach(() => {
    (listIncidents as jest.Mock).mockReset();
  });

  it('returns 401 when auth is required and missing', async () => {
    const response = await handler(
      {
        httpMethod: 'GET',
        path: '/v1/incidents',
        headers: { 'X-Tenant-Id': 'tenant-1' },
        body: null,
        isBase64Encoded: false
      } as never,
      { awsRequestId: 'req-1' } as never
    );

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe('auth_required');
    expect(listIncidents).not.toHaveBeenCalled();
  });
});

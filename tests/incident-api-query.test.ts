export {};

const listIncidents = jest.fn();
const listIncidentEvents = jest.fn();
const getTenantMetrics = jest.fn();

jest.mock('@sentinel/config', () => ({
  getConfig: () => ({
    incidentsTableName: 'Incidents',
    incidentEventsTableName: 'IncidentEvents',
    outboxTableName: 'Outbox',
    outboxTtlSeconds: 60,
    metricsTableName: undefined,
    authRequired: false
  })
}));

jest.mock('@sentinel/dynamodb', () => ({
  listIncidents,
  listIncidentEvents,
  getTenantMetrics,
  getIncidentById: jest.fn(),
  updateIncident: jest.fn(),
  updateActivePointer: jest.fn(),
  deleteActivePointer: jest.fn(),
  putOutboxEvent: jest.fn()
}));

const { handler } = require('../services/incident-api/src/handler');

const baseEvent = {
  httpMethod: 'GET',
  path: '/v1/incidents',
  headers: { 'X-Tenant-Id': 'tenant-1' },
  body: null,
  isBase64Encoded: false
};

describe('incident api query validation', () => {
  beforeEach(() => {
    listIncidents.mockReset();
    listIncidentEvents.mockReset();
    getTenantMetrics.mockReset();
  });

  it('rejects invalid limit on list', async () => {
    const response = await handler(
      { ...baseEvent, queryStringParameters: { limit: '0' } } as never,
      { awsRequestId: 'r1' } as never
    );
    expect(response.statusCode).toBe(400);
  });

  it('rejects invalid next token on list', async () => {
    const response = await handler(
      { ...baseEvent, queryStringParameters: { nextToken: 'not-base64' } } as never,
      { awsRequestId: 'r1' } as never
    );
    expect(response.statusCode).toBe(400);
  });

  it('rejects invalid from timestamp', async () => {
    const response = await handler(
      { ...baseEvent, queryStringParameters: { from: 'not-a-date' } } as never,
      { awsRequestId: 'r1' } as never
    );
    expect(response.statusCode).toBe(400);
  });

  it('returns 501 when metrics not configured', async () => {
    const response = await handler(
      { ...baseEvent, path: '/v1/metrics' } as never,
      { awsRequestId: 'r1' } as never
    );
    expect(response.statusCode).toBe(501);
  });

  it('rejects invalid next token on incident events', async () => {
    const response = await handler(
      {
        ...baseEvent,
        path: '/v1/incidents/inc-1/events',
        queryStringParameters: { nextToken: 'nope' }
      } as never,
      { awsRequestId: 'r1' } as never
    );
    expect(response.statusCode).toBe(400);
  });
});
